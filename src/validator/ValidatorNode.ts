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
import http from "http";
import { AuthenticationMode } from "../types";

export class ValidatorNode {
    public static INIT_WAITING_SECONDS: number = 2;
    public static INTERVAL_SECONDS: number = 12;
    private readonly _app: express.Application;
    private _server: http.Server | null = null;

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
            this._app.set("port", this._config.node.port);
            this._server = http.createServer(this._app);
            this._server.on("error", reject);
            this._server.listen(this._config.node.port, this._config.node.host, async () => {
                await this._worker.start();
                resolve();
            });
        });
    }

    public stop(): Promise<void> {
        return new Promise<void>(async (resolve, reject) => {
            await this._worker.stop();
            await this._worker.waitForStop();
            if (this._server != null) {
                this._server.close((err?) => {
                    if (err) reject(err);
                    else resolve();
                });
            } else resolve();
        });
    }

    public get app(): express.Application {
        return this._app;
    }
}
