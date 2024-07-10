import { Config } from "../common/Config";

import axios from "axios";
import { logger } from "../common/Logger";

/**
 * SMS 를 발송하는 델리게이트의 인터패이스입니다.
 */
export interface ISMSSender {
    send(validatorIndex: number, totalValidatorCount: number, code: string, phone: string): Promise<boolean>;
}

/**
 * SMS 를 발송하는 클래스입니다.
 */
export class SMSSender implements ISMSSender {
    private readonly _config: Config;

    constructor(config: Config) {
        this._config = config;
    }

    public async send(validatorIndex: number, totalValidator: number, code: string, phone: string): Promise<boolean> {
        if (this._config.sms.endpoint === "") {
            logger.error({
                validatorIndex,
                method: "SMSSender.send()",
                message: `The endpoint for SMS is not set up.`,
            });
            return false;
        }

        if (this._config.sms.accessKey === "") {
            logger.error({
                validatorIndex,
                method: "SMSSender.send()",
                message: `The accessKey for SMS is not set up.`,
            });
            return false;
        }

        try {
            const client = axios.create({ headers: { Authorization: this._config.sms.accessKey } });
            const contents: string[] = [];
            const validatorNumber: string = `${validatorIndex + 1}`;
            contents.push(`#${validatorNumber}`);
            contents.push(`Code: ${code}`);
            const response = await client.post(this._config.sms.endpoint, {
                receiver: phone,
                msg: contents.join("\n"),
            });
            if (response.data.code === 200) {
                if (response.data.data.code === "1") {
                    logger.info({
                        validatorIndex,
                        method: "SMSSender.send()",
                        message: `code: ${response.data.data.code}, message: ${response.data.data.message}`,
                    });
                } else {
                    logger.error({
                        validatorIndex,
                        method: "SMSSender.send()",
                        message: `code: ${response.data.data.code}, message: ${response.data.data.message}`,
                    });
                }
            } else {
                logger.error({
                    validatorIndex,
                    method: "SMSSender.send()",
                    message: `code: ${response.data.code}, message: ${response.data.error.message}`,
                });
            }
            return true;
        } catch (e: any) {
            const message = e.message !== undefined ? e.message : "An error has occurred.";
            logger.warn({
                validatorIndex,
                method: "SMSSender.send()",
                message,
            });
            return false;
        }
    }
}

/**
 * SMS 를 발송하는 클래스입니다.
 */
export class SMSNoSender implements ISMSSender {
    public async send(validatorIndex: number, totalValidator: number, code: string, phone: string): Promise<boolean> {
        logger.info({
            validatorIndex: "n",
            method: "SMSNoSender.send()",
            message: `Phone has not been sent.`,
        });
        return true;
    }
}
