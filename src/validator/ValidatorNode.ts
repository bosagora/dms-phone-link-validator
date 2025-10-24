import { Config } from "../common/Config";
import { logger } from "../common/Logger";
import { CodeGenerator, FixedCodeGenerator, ICodeGenerator } from "../delegator/CodeGenerator";
import { ISMSSender, SMSNoSender, SMSSender } from "../delegator/SMSSender";
import { Storage } from "../storage/Storages";
import { Peers } from "./Peers";
import { Router } from "./Router";
import { Worker } from "./Worker";

import { register } from "prom-client";
import { Metrics } from "../metrics/Metrics";

import bodyParser from "body-parser";
import cors from "cors";
import express from "express";
import fs from "fs";
import http from "http";
import https from "https";
import { AuthenticationMode } from "../types";

export class ValidatorNode {
    public static INIT_WAITING_SECONDS: number = 2;
    public static INTERVAL_SECONDS: number = 12;
    private readonly _app: express.Application;
    private _httpsServer: https.Server | null = null;
    private _httpServer: http.Server | null = null;

    private readonly _config: Config;
    private readonly _metrics: Metrics;
    private readonly _router: Router;
    private readonly _storage: Storage;
    private readonly _peers: Peers;
    private readonly _worker: Worker;

    private readonly _phoneSender: ISMSSender;
    private readonly _codeGenerator: ICodeGenerator;

    constructor(config: Config, storage: Storage) {
        this._app = express();
        this._config = config;
        this._storage = storage;
        this._peers = new Peers();

        register.clear();
        this._metrics = new Metrics();
        this._metrics.create("gauge", "status", "serve status");
        this._metrics.create("summary", "success", "request success");
        this._metrics.create("summary", "failure", "request failure");

        if (
            this._config.validator.authenticationMode === AuthenticationMode.NoSMSNoCode ||
            this._config.validator.authenticationMode === AuthenticationMode.NoSMSKnownCode
        ) {
            this._phoneSender = new SMSNoSender();
        } else {
            logger.info({
                validatorIndex: "n",
                method: "ValidatorNode.constructor()",
                message: `AuthenticationMode.YesSMS`,
            });
            this._phoneSender = new SMSSender(this._config);
        }

        if (this._config.validator.authenticationMode === AuthenticationMode.YesSMSUnknownCode) {
            logger.info({
                validatorIndex: "n",
                method: "ValidatorNode.constructor()",
                message: `AuthenticationMode.UnknownCode`,
            });
            this._codeGenerator = new CodeGenerator();
        } else {
            this._codeGenerator = new FixedCodeGenerator(0);
        }

        this._router = new Router(
            this,
            this._config,
            this._metrics,
            this._storage,
            this._peers,
            this._phoneSender,
            this._codeGenerator
        );
        this._worker = new Worker("*/1 * * * * *", this, this._router);
    }

    public async start(): Promise<void> {
        this._app.use(bodyParser.urlencoded({ extended: false, limit: "1mb" }));
        this._app.use(bodyParser.json({ limit: "1mb" }));
        this._app.use(
            cors({
                allowedHeaders: "*",
                credentials: true,
                methods: "GET, POST",
                origin: "*",
                preflightContinue: false,
            })
        );
        this._router.registerRoutes();

        return new Promise<void>((resolve, reject) => {
            const promises: Promise<void>[] = [];

            if (!this._config.node.http.enable && !this._config.node.https.enable) {
                reject(new Error("At least one of HTTP or HTTPS server must be enabled"));
                return;
            }

            if (this._config.node.https.enable) {
                if (!this._config.node.https.cert || !this._config.node.https.key) {
                    reject(new Error("HTTPS is enabled but certificate or key path is not configured"));
                    return;
                }

                if (!fs.existsSync(this._config.node.https.cert)) {
                    reject(new Error(`SSL certificate file not found: ${this._config.node.https.cert}`));
                    return;
                }

                if (!fs.existsSync(this._config.node.https.key)) {
                    reject(new Error(`SSL key file not found: ${this._config.node.https.key}`));
                    return;
                }

                const options = {
                    cert: fs.readFileSync(this._config.node.https.cert),
                    key: fs.readFileSync(this._config.node.https.key),
                };

                this._httpsServer = https.createServer(options, this._app);

                const httpsPromise = new Promise<void>((res, rej) => {
                    this._httpsServer!.on("error", rej);
                    this._httpsServer!.listen(this._config.node.https.port, this._config.node.host, () => {
                        console.log(
                            `HTTPS server listening on ${this._config.node.host}:${this._config.node.https.port}`
                        );
                        res();
                    });
                });
                promises.push(httpsPromise);
            }

            if (this._config.node.http.enable) {
                this._httpServer = http.createServer(this._app);

                const httpPromise = new Promise<void>((res, rej) => {
                    this._httpServer!.listen(this._config.node.http.port, this._config.node.host, () => {
                        const message = this._config.node.https.enable
                            ? `HTTP server listening on ${this._config.node.host}:${this._config.node.http.port} (internal use)`
                            : `HTTP server listening on ${this._config.node.host}:${this._config.node.http.port}`;
                        console.log(message);
                        res();
                    }).on("error", (err: any) => {
                        if (this._config.node.https.enable) {
                            if (err.code === "EADDRINUSE") {
                                console.warn(
                                    `HTTP port ${this._config.node.http.port} is already in use. Skipping HTTP server.`
                                );
                            } else if (err.code === "EACCES") {
                                console.warn(
                                    `HTTP port ${this._config.node.http.port} requires elevated privileges. Skipping HTTP server.`
                                );
                            } else {
                                console.warn(`Failed to start HTTP server: ${err.message}`);
                            }
                            res();
                        } else {
                            rej(err);
                        }
                    });
                });
                promises.push(httpPromise);
            }

            Promise.all(promises)
                .then(async () => {
                    await this._worker.start();
                    resolve();
                })
                .catch((err) => reject(err));
        });
    }

    public async stop(): Promise<void> {
        await this._worker.stop();
        await this._worker.waitForStop();

        const promises: Promise<void>[] = [];

        if (this._httpsServer) {
            promises.push(
                new Promise<void>((res, rej) => {
                    this._httpsServer!.close((err) => {
                        if (err) rej(err);
                        else res();
                    });
                })
            );
        }

        if (this._httpServer) {
            promises.push(
                new Promise<void>((res, rej) => {
                    this._httpServer!.close((err) => {
                        if (err) rej(err);
                        else res();
                    });
                })
            );
        }

        return Promise.all(promises).then(() => {
            //
        });
    }

    public get app(): express.Application {
        return this._app;
    }
}
