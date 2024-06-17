import { PhoneLinkCollection } from "../../typechain-types";
import { Config } from "../common/Config";
import { logger } from "../common/Logger";
import { GasPriceManager } from "../contract/GasPriceManager";
import { ICodeGenerator } from "../delegator/CodeGenerator";
import { ISMSSender } from "../delegator/SMSSender";
import { Metrics } from "../metrics/Metrics";
import { Storage } from "../storage/Storages";
import {
    AuthenticationMode,
    ISubmitData,
    ITransaction,
    IValidationData,
    PhoneValidationStatus,
    ProcessStep,
    toTransaction,
    toValidationData,
    ValidatorNodeInfo,
} from "../types";
import { ContractUtils } from "../utils/ContractUtils";
import { Peer, Peers } from "./Peers";
import { ValidatorNode } from "./ValidatorNode";

import { NonceManager } from "@ethersproject/experimental";
import "@nomiclabs/hardhat-ethers";
import { BigNumberish, Signer, Wallet } from "ethers";
import * as hre from "hardhat";

import express from "express";
import { body, validationResult } from "express-validator";
import ip from "ip";

import { PhoneNumberFormat, PhoneNumberUtil } from "google-libphonenumber";

export class Router {
    private readonly _validator: ValidatorNode;
    private readonly _config: Config;
    private readonly _metrics: Metrics;
    private readonly _storage: Storage;
    private readonly _wallet: Wallet;
    private _peers: Peers;
    private _contract: PhoneLinkCollection | undefined;

    private readonly nodeInfo: ValidatorNodeInfo;

    private _initialized: boolean = false;

    private _startTimeStamp: number = 0;
    private _oldTimeStamp: number = 0;
    private _periodNumber: number = 0;

    private _validatorIndex: number;
    private _validators: Map<string, string> = new Map<string, string>();

    private readonly _phoneSender: ISMSSender;
    private readonly _codeGenerator: ICodeGenerator;

    private _phoneUtil: PhoneNumberUtil;

    constructor(
        validator: ValidatorNode,
        config: Config,
        metrics: Metrics,
        storage: Storage,
        peers: Peers,
        phoneSender: ISMSSender,
        codeGenerator: ICodeGenerator
    ) {
        this._phoneUtil = PhoneNumberUtil.getInstance();
        this._validator = validator;
        this._config = config;
        this._metrics = metrics;
        this._storage = storage;
        this._peers = peers;
        this._phoneSender = phoneSender;
        this._codeGenerator = codeGenerator;
        this._wallet = new Wallet(this._config.validator.validatorKey, hre.ethers.provider);
        this._validatorIndex = -1;

        const host = this._config.node.external !== "" ? this._config.node.external : ip.address();
        this.nodeInfo = {
            nodeId: this._wallet.address.toLowerCase(),
            endpoint: `${this._config.node.protocol}://${host}:${this._config.node.port}`,
            version: "v1.0.0",
        };
        this._startTimeStamp = ContractUtils.getTimeStamp();

        logger.info({
            validatorIndex: "n",
            method: "Router.constructor()",
            message: `nodeId: ${this.nodeInfo.nodeId}, endpoint: ${this.nodeInfo.endpoint}`,
        });
    }

    private async getContract(): Promise<PhoneLinkCollection> {
        if (this._contract === undefined) {
            const factory = await hre.ethers.getContractFactory("PhoneLinkCollection");
            this._contract = factory.attach(this._config.contracts.phoneLinkCollectionAddress) as PhoneLinkCollection;
        }
        return this._contract;
    }

    private getSigner(): Signer {
        return new NonceManager(new GasPriceManager(this._wallet));
    }

    private makeResponseData(code: number, data: any, error?: any): any {
        return {
            code,
            data,
            error,
        };
    }

    public async makePeers() {
        const res = await (await this.getContract()).getValidators();

        // 신규 검증자 맵에 추가
        for (const item of res) {
            this._validators.set(item.validator.toLowerCase(), item.endpoint);
        }

        // 없어진 검증자를 맵에서 제거
        for (const key of this._validators.keys()) {
            if (res.find((m: any) => m.validator.toLowerCase() === key) === undefined) {
                this._validators.delete(key);
            }
        }

        // 새로 추가된 검증자 맵에 추가
        for (const item of res) {
            const nodeId = item.validator.toLowerCase();
            const index = item.index.toNumber();
            const endpoint = item.endpoint;
            if (this._wallet.address.toLowerCase() === nodeId) {
                if (this._validatorIndex !== index) {
                    this._validatorIndex = index;
                    if (
                        this._config.validator.authenticationMode === AuthenticationMode.NoSMSKnownCode ||
                        this._config.validator.authenticationMode === AuthenticationMode.YesSMSKnownCode
                    ) {
                        this._codeGenerator.setValue(this._validatorIndex);
                    }
                    logger.info({
                        validatorIndex: this._validatorIndex,
                        method: "Router.makePeers()",
                        message: `Validator - nodeId: ${this.nodeInfo.nodeId}, index: ${this._validatorIndex}, endpoint: ${this.nodeInfo.endpoint}`,
                    });
                }
            } else {
                const oldPeer = this._peers.items.find((m) => m.nodeId === nodeId);
                if (oldPeer !== undefined) {
                    if (oldPeer.endpoint !== endpoint || oldPeer.index !== index) {
                        oldPeer.endpoint = endpoint;
                        oldPeer.index = index;
                        logger.info({
                            validatorIndex: this._validatorIndex,
                            method: "Router.makePeers()",
                            message: `Peer - nodeId: ${oldPeer.nodeId}, index: ${oldPeer.index}, endpoint: ${oldPeer.endpoint}`,
                        });
                    }
                } else {
                    const peer = new Peer(nodeId, index, endpoint, "");
                    this._peers.items.push(peer);
                    logger.info({
                        validatorIndex: this._validatorIndex,
                        method: "Router.makePeers()",
                        message: `Peer - nodeId: ${peer.nodeId}, index: ${peer.index}, endpoint: ${peer.endpoint}`,
                    });
                }
            }
        }

        // 없어진 Peer 를 찾아서 맵에서 제거한다
        let done = false;
        while (!done) {
            done = true;
            for (let idx = 0; idx < this._peers.items.length; idx++) {
                if (res.find((m: any) => m.validator.toLowerCase() === this._peers.items[idx].nodeId) === undefined) {
                    this._peers.items.splice(idx, 1);
                    done = false;
                    break;
                }
            }
        }
    }

    public registerRoutes() {
        this._validator.app.get("/", [], this.getHealthStatus.bind(this));
        this._validator.app.get("/info", [], this.getInfo.bind(this));
        this._validator.app.get("/peers", [], this.getPeers.bind(this));
        this._validator.app.post(
            "/request",
            [
                body("phone").exists(),
                body("address").exists().trim().isEthereumAddress(),
                body("signature")
                    .exists()
                    .trim()
                    .matches(/^(0x)[0-9a-f]{130}$/i),
            ],
            this.postRequest.bind(this)
        );
        this._validator.app.post(
            "/broadcast",
            [
                body("request").exists(),
                body("request.phone").exists(),
                body("request.address").exists().trim().isEthereumAddress(),
                body("request.nonce")
                    .exists()
                    .trim()
                    .matches(/^[0-9]+$/),
                body("request.signature")
                    .exists()
                    .trim()
                    .matches(/^(0x)[0-9a-f]{130}$/i),
                body("requestId")
                    .exists()
                    .trim()
                    .matches(/^(0x)[0-9a-f]{64}$/i),
                body("receiver").exists().trim().isEthereumAddress(),
                body("signature")
                    .exists()
                    .trim()
                    .matches(/^(0x)[0-9a-f]{130}$/i),
            ],
            this.postBroadcast.bind(this)
        );
        this._validator.app.post(
            "/submit",
            [
                body("requestId")
                    .exists()
                    .trim()
                    .matches(/^(0x)[0-9a-f]{64}$/i),
                body("code")
                    .exists()
                    .trim()
                    .matches(/^[0-9]+$/),
            ],
            this.postSubmit.bind(this)
        );
        this._validator.app.post(
            "/broadcastSubmit",
            [
                body("requestId")
                    .exists()
                    .trim()
                    .matches(/^(0x)[0-9a-f]{64}$/i),
                body("code")
                    .exists()
                    .trim()
                    .matches(/^[0-9]+$/),
                body("receiver").exists().trim().isEthereumAddress(),
                body("signature")
                    .exists()
                    .trim()
                    .matches(/^(0x)[0-9a-f]{130}$/i),
            ],
            this.postBroadcastSubmit.bind(this)
        );
        this._validator.app.get("/metrics", [], this.getMetrics.bind(this));
    }

    private async getHealthStatus(req: express.Request, res: express.Response) {
        return res.json("OK");
    }

    private async getInfo(req: express.Request, res: express.Response) {
        logger.http({ validatorIndex: this._validatorIndex, method: "Router.getInfo()", message: "GET /info" });

        return res.json(this.makeResponseData(200, this.nodeInfo, undefined));
    }

    private async getPeers(req: express.Request, res: express.Response) {
        logger.http({ validatorIndex: this._validatorIndex, method: "Router.getPeers()", message: "GET /peers" });

        const data = this._peers.items.map((m) => {
            return { nodeId: m.nodeId, endpoint: m.endpoint, version: m.version, status: m.status };
        });

        return res.json(this.makeResponseData(200, data, undefined));
    }

    private async getRequestId(phoneHash: string, address: string, nonce: BigNumberish): Promise<string> {
        // 내부에 랜덤으로 32 Bytes 를 생성하여 ID를 생성하므로 무한반복될 가능성이 극히 낮음
        while (true) {
            const id = ContractUtils.getRequestId(phoneHash, address, nonce);
            if (await (await this.getContract()).isAvailable(id)) return id;
        }
    }

    private async postRequest(req: express.Request, res: express.Response) {
        logger.http({
            validatorIndex: this._validatorIndex,
            method: "Router.postRequest()",
            message: `POST /request - ${req.ip}:${JSON.stringify(req.body)}`,
        });

        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.json(
                this.makeResponseData(400, undefined, {
                    message: "Failed to check the validity of parameters.",
                    validation: errors.array(),
                })
            );
        }

        try {
            let phone: string = String(req.body.phone).trim();
            try {
                const number = this._phoneUtil.parseAndKeepRawInput(phone, "ZZ");
                if (!this._phoneUtil.isValidNumber(number)) {
                    return res.status(200).json(
                        this.makeResponseData(401, undefined, {
                            message: "Invalid phone number",
                        })
                    );
                } else {
                    phone = this._phoneUtil.format(number, PhoneNumberFormat.INTERNATIONAL);
                }
            } catch (e) {
                this.makeResponseData(401, undefined, {
                    message: "Invalid phone number",
                });
            }
            const address: string = String(req.body.address).trim(); // 주소
            const signature: string = String(req.body.signature).trim(); // 서명
            const nonce = await (await this.getContract()).nonceOf(address);
            const phoneHash = ContractUtils.getPhoneHash(phone);
            const reqMsg = ContractUtils.getRequestMessage(
                phoneHash,
                address,
                hre.ethers.provider.network.chainId,
                nonce
            );
            if (!ContractUtils.verifyMessage(address, reqMsg, signature)) {
                return res.json(
                    this.makeResponseData(401, undefined, {
                        message: "The signature value entered is not valid.",
                    })
                );
            }

            const requestId = await this.getRequestId(phoneHash, address, nonce);
            const tx: ITransaction = {
                request: {
                    phone,
                    address,
                    nonce: nonce.toString(),
                    signature,
                },
                requestId,
                receiver: this._wallet.address,
                signature: "",
            };
            const txMsg = ContractUtils.getTxMessage(tx, hre.ethers.provider.network.chainId);
            tx.signature = await ContractUtils.signMessage(this.getSigner(), txMsg);

            try {
                const data: IValidationData = toValidationData(tx);
                data.processStep = ProcessStep.RECEIVED_REGISTER;
                await this._storage.createValidation(data);

                this._metrics.add("success", 1);
                return res.json(
                    this.makeResponseData(200, {
                        requestId,
                    })
                );
            } catch (error: any) {
                this._metrics.add("failure", 1);
                const message = error.message !== undefined ? error.message : "Failed save request";
                return res.json(
                    this.makeResponseData(800, undefined, {
                        message,
                    })
                );
            }
        } catch (error: any) {
            this._metrics.add("failure", 1);
            const message = error.message !== undefined ? error.message : "Failed save request";
            logger.error({
                validatorIndex: this._validatorIndex,
                method: "Router.postRequest()",
                message,
            });
            return res.json(
                this.makeResponseData(500, undefined, {
                    message,
                })
            );
        }
    }

    private async postBroadcast(req: express.Request, res: express.Response) {
        logger.http({
            validatorIndex: this._validatorIndex,
            method: "Router.postBroadcast()",
            message: `POST /broadcast - ${req.ip}:${JSON.stringify(req.body)}`,
        });

        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.json(
                this.makeResponseData(400, undefined, {
                    message: "Failed to check the validity of parameters.",
                    validation: errors.array(),
                })
            );
        }

        try {
            let phone: string = String(req.body.request.phone).trim();
            try {
                const number = this._phoneUtil.parseAndKeepRawInput(phone, "ZZ");
                if (!this._phoneUtil.isValidNumber(number)) {
                    return res.status(200).json(
                        this.makeResponseData(401, undefined, {
                            message: "Invalid phone number",
                        })
                    );
                } else {
                    phone = this._phoneUtil.format(number, PhoneNumberFormat.INTERNATIONAL);
                }
            } catch (e) {
                this.makeResponseData(401, undefined, {
                    message: "Invalid phone number",
                });
            }
            const address = String(req.body.request.address).trim();
            const nonce = String(req.body.request.nonce).trim();
            const signature = String(req.body.request.signature).trim();

            const tx: ITransaction = {
                request: {
                    phone,
                    address,
                    nonce,
                    signature,
                },
                requestId: String(req.body.requestId).trim(),
                receiver: String(req.body.receiver).trim(),
                signature: String(req.body.signature).trim(),
            };

            const txMsg = ContractUtils.getTxMessage(tx, hre.ethers.provider.network.chainId);
            if (!ContractUtils.verifyMessage(tx.receiver, txMsg, tx.signature)) {
                return res.json(
                    this.makeResponseData(401, undefined, {
                        message: "The signature value entered is not valid.",
                    })
                );
            }

            if (this._validators.get(tx.receiver.toLowerCase()) === undefined) {
                return res.json(
                    this.makeResponseData(402, undefined, {
                        message: "Receiver is not validator.",
                    })
                );
            }

            try {
                const data: IValidationData = toValidationData(tx);
                data.processStep = ProcessStep.RECEIVED_BROADCAST;
                await this._storage.createValidation(data);

                this._metrics.add("success", 1);
                return res.json(
                    this.makeResponseData(200, {
                        requestId: data.requestId,
                    })
                );
            } catch (error: any) {
                this._metrics.add("failure", 1);
                const message = error.message !== undefined ? error.message : "Failed save request";
                return res.json(
                    this.makeResponseData(800, undefined, {
                        message,
                    })
                );
            }
        } catch (error: any) {
            this._metrics.add("failure", 1);
            const message = error.message !== undefined ? error.message : "Failed broadcast request";
            logger.error({
                validatorIndex: this._validatorIndex,
                method: "Router.postBroadcast()",
                message,
            });
            return res.json(
                this.makeResponseData(500, undefined, {
                    message,
                })
            );
        }
    }

    private async postSubmit(req: express.Request, res: express.Response) {
        logger.http({
            validatorIndex: this._validatorIndex,
            method: "Router.postSubmit()",
            message: `POST /submit - ${req.ip}:${JSON.stringify(req.body)}`,
        });

        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.json(
                this.makeResponseData(400, undefined, {
                    message: "Failed to check the validity of parameters.",
                    validation: errors.array(),
                })
            );
        }

        try {
            const requestId = String(req.body.requestId).trim();
            const code = String(req.body.code).trim();
            const submitData: ISubmitData = {
                requestId,
                code,
                receiver: this._wallet.address,
                signature: "",
            };
            const submitMsg = ContractUtils.getSubmitMessage(submitData, hre.ethers.provider.network.chainId);
            submitData.signature = await ContractUtils.signMessage(this.getSigner(), submitMsg);
            await this._peers.broadcastSubmit(submitData);

            this._metrics.add("success", 1);
            return this.processSubmit(requestId, code, res);
        } catch (error: any) {
            const message = error.message !== undefined ? error.message : "Failed submit";
            logger.error({
                validatorIndex: this._validatorIndex,
                method: "Router.postSubmit()",
                message,
            });
            this._metrics.add("failure", 1);
            return res.json(
                this.makeResponseData(500, undefined, {
                    message,
                })
            );
        }
    }

    private async postBroadcastSubmit(req: express.Request, res: express.Response) {
        logger.http({
            validatorIndex: this._validatorIndex,
            method: "Router.postBroadcastSubmit()",
            message: `POST /broadcastSubmit - ${req.ip}:${JSON.stringify(req.body)}`,
        });

        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.json(
                this.makeResponseData(400, undefined, {
                    message: "Failed to check the validity of parameters.",
                    validation: errors.array(),
                })
            );
        }

        try {
            const requestId = String(req.body.requestId).trim();
            const code = String(req.body.code).trim();
            const submitData: ISubmitData = {
                requestId,
                code,
                receiver: String(req.body.receiver).trim(),
                signature: String(req.body.signature).trim(),
            };

            const submitMsg = ContractUtils.getSubmitMessage(submitData, hre.ethers.provider.network.chainId);
            if (!ContractUtils.verifyMessage(submitData.receiver, submitMsg, submitData.signature)) {
                return res.json(
                    this.makeResponseData(401, undefined, {
                        message: "The signature value entered is not valid.",
                    })
                );
            }

            if (this._validators.get(submitData.receiver.toLowerCase()) === undefined) {
                return res.json(
                    this.makeResponseData(402, undefined, {
                        message: "Receiver is not validator.",
                    })
                );
            }

            return this.processSubmit(requestId, code, res);
        } catch (error: any) {
            const message = error.message !== undefined ? error.message : "Failed broadcast submit";
            logger.error({
                validatorIndex: this._validatorIndex,
                method: "Router.postBroadcastSubmit()",
                message,
            });
            this._metrics.add("failure", 1);
            return res.json(
                this.makeResponseData(500, undefined, {
                    message,
                })
            );
        }
    }

    private async processSendPhone(validation: IValidationData) {
        if (validation.validationStatus === PhoneValidationStatus.NONE) {
            const sendCode = this._codeGenerator.getCode();
            await this._phoneSender.send(
                this._validatorIndex,
                this._validators.size,
                sendCode,
                validation.requestPhone
            );
            validation.sendCode = sendCode;
            validation.validationStatus = PhoneValidationStatus.SENT;
            validation.expire = ContractUtils.getTimeStamp() + 5 * 60;

            await this._storage.updateSendCode(validation);
        }
    }

    private async processSubmit(requestId: string, receiveCode: string, res: express.Response) {
        const validation = await this._storage.getValidation(requestId);
        if (validation !== undefined) {
            if (validation.validationStatus === PhoneValidationStatus.SENT) {
                if (validation.expire > ContractUtils.getTimeStamp()) {
                    validation.receiveCode = receiveCode.substring(
                        this._validatorIndex * 2,
                        this._validatorIndex * 2 + 2
                    );
                    await this._storage.updateReceiveCode(requestId, validation.receiveCode);
                    if (validation.sendCode === validation.receiveCode) {
                        await this._storage.updateProcessStep(requestId, ProcessStep.RECEIVED_CODE);
                        this._metrics.add("success", 1);
                        return res.json(this.makeResponseData(200, "OK"));
                    } else {
                        logger.warn({
                            validatorIndex: this._validatorIndex,
                            method: "Router.processSubmit()",
                            message: `The authentication code is different. ${requestId}`,
                        });
                        return res.json(
                            this.makeResponseData(440, null, { message: "The authentication code is different." })
                        );
                    }
                } else {
                    await this._storage.updateValidationStatus(validation.requestId, PhoneValidationStatus.EXPIRED);

                    logger.warn({
                        validatorIndex: this._validatorIndex,
                        method: "Router.processSubmit()",
                        message: `The authentication code is expired. ${requestId}`,
                    });
                    return res.json(
                        this.makeResponseData(430, null, { message: "The authentication code is expired." })
                    );
                }
            } else if (validation.validationStatus === PhoneValidationStatus.NONE) {
                logger.warn({
                    validatorIndex: this._validatorIndex,
                    method: "Router.processSubmit()",
                    message: `The phone has not been sent. ${requestId}`,
                });
                return res.json(this.makeResponseData(420, null, { message: "The phone has not been sent." }));
            } else if (validation.validationStatus === PhoneValidationStatus.CONFIRMED) {
                logger.warn({
                    validatorIndex: this._validatorIndex,
                    method: "Router.processSubmit()",
                    message: `Processing has already been completed. ${requestId}`,
                });
                return res.json(
                    this.makeResponseData(421, null, { message: "Processing has already been completed." })
                );
            } else if (validation.validationStatus === PhoneValidationStatus.EXPIRED) {
                logger.warn({
                    validatorIndex: this._validatorIndex,
                    method: "Router.processSubmit()",
                    message: `The authentication code is expired. ${requestId}`,
                });
                return res.json(this.makeResponseData(422, null, { message: "The authentication code is expired." }));
            }
        } else {
            logger.warn({
                validatorIndex: this._validatorIndex,
                method: "Router.processSubmit()",
                message: `No such request found. ${requestId}`,
            });
            this._metrics.add("failure", 1);
            return res.json(this.makeResponseData(410, null, { message: "No such request found." }));
        }
    }

    private async updateEndpointOnContract() {
        try {
            await (await this.getContract()).connect(this.getSigner()).updateEndpoint(this.nodeInfo.endpoint);
        } catch (e: any) {
            const message = e.message !== undefined ? e.message : "Error when calling contract";
            logger.error({
                validatorIndex: this._validatorIndex,
                method: "Router.updateEndpointOnContract()",
                message,
            });
        }
    }

    private async addRequest(requestId: string, phoneHash: string, address: string, signature: string) {
        try {
            await (await this.getContract())
                .connect(this.getSigner())
                .addRequest(requestId, phoneHash, address, signature);
        } catch (e: any) {
            const message = e.message !== undefined ? e.message : "Error when saving a request to the contract.";
            logger.error({
                validatorIndex: this._validatorIndex,
                method: "Router.addRequest()",
                message,
            });
        }
    }

    private async voteAgreement(requestId: string) {
        try {
            await (await this.getContract()).connect(this.getSigner()).voteRequest(requestId);
        } catch (e: any) {
            const message = e.message !== undefined ? e.message : "Error when calling contract";
            logger.error({
                validatorIndex: this._validatorIndex,
                method: "Router.voteAgreement()",
                message,
            });
        }
    }

    private async countVote(requestId: string) {
        try {
            await (await this.getContract()).connect(this.getSigner()).countVote(requestId);
        } catch (e: any) {
            const message = e.message !== undefined ? e.message : "Error when calling contract";
            logger.error({
                validatorIndex: this._validatorIndex,
                method: "Router.voteAgreement()",
                message,
            });
        }
    }

    public async onWork() {
        const currentTime = ContractUtils.getTimeStamp();
        if (currentTime - this._startTimeStamp < ValidatorNode.INIT_WAITING_SECONDS) {
            this._oldTimeStamp = currentTime;
            return;
        }

        this._periodNumber = Math.floor(currentTime / ValidatorNode.INTERVAL_SECONDS);

        if (!this._initialized) {
            await this.updateEndpointOnContract();
            await this.makePeers();
            await this._peers.check();
            this._initialized = true;
        }

        const validations = await this._storage.getUnfinishedJob();
        for (const validation of validations) {
            switch (validation.processStep) {
                case ProcessStep.RECEIVED_REGISTER:
                    logger.info({
                        validatorIndex: this._validatorIndex,
                        method: "Router.onWork()",
                        message: `ProcessStep.REGISTER ${validation.requestId}`,
                    });
                    const phoneHash = ContractUtils.getPhoneHash(validation.requestPhone);
                    await this.addRequest(
                        validation.requestId,
                        phoneHash,
                        validation.requestAddress,
                        validation.requestSignature
                    );
                    await this._peers.broadcast(toTransaction(validation));

                    await this.processSendPhone(validation);
                    await this._storage.updateProcessStep(validation.requestId, ProcessStep.SENT_SMS);

                    if (this._config.validator.authenticationMode === AuthenticationMode.NoSMSNoCode) {
                        setTimeout(async () => {
                            await this._storage.updateProcessStep(validation.requestId, ProcessStep.RECEIVED_CODE);
                        }, 3000);
                    }
                    break;

                case ProcessStep.RECEIVED_BROADCAST:
                    logger.info({
                        validatorIndex: this._validatorIndex,
                        method: "Router.onWork()",
                        message: `ProcessStep.BROADCAST ${validation.requestId}`,
                    });

                    await this.processSendPhone(validation);
                    await this._storage.updateProcessStep(validation.requestId, ProcessStep.SENT_SMS);

                    if (this._config.validator.authenticationMode === AuthenticationMode.NoSMSNoCode) {
                        setTimeout(async () => {
                            await this._storage.updateProcessStep(validation.requestId, ProcessStep.RECEIVED_CODE);
                        }, 3000);
                    }
                    break;

                case ProcessStep.SENT_SMS:
                    break;

                case ProcessStep.RECEIVED_CODE:
                    logger.info({
                        validatorIndex: this._validatorIndex,
                        method: "Router.onWork()",
                        message: `ProcessStep.RECEIVED_CODE ${validation.requestId}`,
                    });
                    await this.voteAgreement(validation.requestId);
                    await this._storage.updateProcessStep(validation.requestId, ProcessStep.VOTED);
                    break;

                case ProcessStep.VOTED:
                    const res = await (await this.getContract()).canCountVote(validation.requestId);
                    if (res === 1) {
                        logger.info({
                            validatorIndex: this._validatorIndex,
                            method: "Router.onWork()",
                            message: `ProcessStep.COUNT, Counting is possible. ${validation.requestId}`,
                        });
                        await this.countVote(validation.requestId);
                        await this._storage.updateValidationStatus(
                            validation.requestId,
                            PhoneValidationStatus.CONFIRMED
                        );
                        await this._storage.updateProcessStep(validation.requestId, ProcessStep.FINISHED);
                    } else if (res === 2) {
                        logger.info({
                            validatorIndex: this._validatorIndex,
                            method: "Router.onWork()",
                            message: `ProcessStep.COUNT, Counting is impossible. ${validation.requestId}`,
                        });
                    } else {
                        logger.info({
                            validatorIndex: this._validatorIndex,
                            method: "Router.onWork()",
                            message: `ProcessStep.COUNT, Counting has already been completed. ${validation.requestId}`,
                        });
                        await this._storage.updateValidationStatus(
                            validation.requestId,
                            PhoneValidationStatus.CONFIRMED
                        );
                        await this._storage.updateProcessStep(validation.requestId, ProcessStep.FINISHED);
                    }
                    break;
            }
        }

        const old_period = Math.floor(this._oldTimeStamp / ValidatorNode.INTERVAL_SECONDS);
        if (old_period !== this._periodNumber) {
            await this.makePeers();
            await this._peers.check();
            await this._storage.removeExpiredValidation();
        }
        this._oldTimeStamp = currentTime;
    }

    /**
     * GET /metrics
     * @private
     */
    private async getMetrics(req: express.Request, res: express.Response) {
        res.set("Content-Type", this._metrics.contentType());
        this._metrics.add("status", 1);
        res.end(await this._metrics.metrics());
    }
}
