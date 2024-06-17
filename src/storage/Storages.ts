import * as mkdirp from "mkdirp";
import path from "path";
import * as sqlite from "sqlite3";
import { IValidationData, PhoneValidationStatus, ProcessStep } from "../types";
import { ContractUtils } from "../utils/ContractUtils";

export class Storage {
    protected _db: sqlite.Database | undefined;

    constructor() {
        //
    }

    public get db(): sqlite.Database {
        if (this._db === undefined) {
            throw new Error("Storage is not opened");
        }
        return this._db;
    }

    public static async make(filename: string): Promise<Storage> {
        const storage = new Storage();
        await storage.open(filename);
        return storage;
    }

    public open(filename: string): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (filename !== ":memory:") {
                filename = path.resolve(filename);
                mkdirp.mkdirpSync(path.dirname(filename));
            }
            this._db = new sqlite.Database(
                filename,
                sqlite.OPEN_CREATE | sqlite.OPEN_READWRITE,
                (error1: Error | null) => {
                    if (error1 !== null) reject(error1);
                    this.createTables()
                        .then(() => {
                            resolve();
                        })
                        .catch((error2) => {
                            reject(error2);
                        });
                }
            );
        });
    }

    public close() {
        this.db.close();
    }

    protected query(sql: string, params: any): Promise<any[]> {
        return new Promise<any[]>((resolve, reject) => {
            this.db.all(sql, params, (error: Error | null, rows: any[]) => {
                if (!error) resolve(rows);
                else reject(error);
            });
        });
    }

    protected async run(sql: string, params: any): Promise<sqlite.RunResult> {
        return new Promise<sqlite.RunResult>((resolve, reject) => {
            this.db.run(sql, params, function (error: Error) {
                if (!error) resolve(this);
                else reject(error);
            });
        });
    }

    protected exec(sql: string): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.db.exec(sql, (error: Error | null) => {
                if (!error) resolve();
                else reject(error);
            });
        });
    }

    protected begin(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.db.run("BEGIN", (error: Error | null) => {
                if (error == null) resolve();
                else reject(error);
            });
        });
    }

    protected commit(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.db.run("COMMIT", (error: Error | null) => {
                if (error == null) resolve();
                else reject(error);
            });
        });
    }

    protected rollback(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.db.run("ROLLBACK", (error: Error | null) => {
                if (error == null) resolve();
                else reject(error);
            });
        });
    }

    public createTables(): Promise<void> {
        const sql = `CREATE TABLE IF NOT EXISTS validation
        (
            requestId           TEXT    NOT NULL,
            requestPhone        TEXT    NOT NULL,
            requestAddress      TEXT    NOT NULL,
            requestNonce        TEXT    NOT NULL,
            requestSignature    TEXT    NOT NULL,
            receiver            TEXT,
            signature           TEXT,
            validationStatus    INTEGER DEFAULT 0 NOT NULL,
            sendCode            TEXT DEFAULT "" NOT NULL,
            receiveCode         TEXT DEFAULT "" NOT NULL,
            expire              INTEGER DEFAULT 0 NOT NULL,
            processStep         INTEGER DEFAULT 0 NOT NULL,
            PRIMARY KEY(requestId)
        );
        `;

        return this.exec(sql);
    }

    public async createValidation(data: IValidationData) {
        await this.run(
            `INSERT INTO validation
            (requestId, requestPhone, requestAddress, requestNonce, requestSignature, receiver, signature, validationStatus, sendCode, receiveCode, expire, processStep)
            VALUES
            (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                data.requestId,
                data.requestPhone,
                data.requestAddress,
                data.requestNonce,
                data.requestSignature,
                data.receiver,
                data.signature,
                data.validationStatus,
                data.sendCode,
                data.receiveCode,
                data.expire,
                data.processStep,
            ]
        );
    }

    public async updateValidationStatus(requestId: string, value: PhoneValidationStatus) {
        await this.run(
            `UPDATE validation
            SET
                validationStatus = ?
            WHERE
                requestId = ?`,
            [value, requestId]
        );
    }

    public async updateSendCode(data: IValidationData) {
        await this.run(
            `UPDATE validation
             SET
                 validationStatus = ?,
                 sendCode = ?,
                 expire = ?
             WHERE
                 requestId = ?`,
            [data.validationStatus, data.sendCode, data.expire, data.requestId]
        );
    }

    public async updateReceiveCode(requestId: string, receiveCode: string) {
        await this.run(
            `UPDATE validation
             SET
                 receiveCode = ?
             WHERE
                 requestId = ?`,
            [receiveCode, requestId]
        );
    }

    public async updateProcessStep(requestId: string, processStep: ProcessStep) {
        await this.run(
            `UPDATE validation
             SET
                 processStep = ?
             WHERE
                 requestId = ?`,
            [processStep, requestId]
        );
    }

    public async removeExpiredValidation() {
        await this.run(`DELETE FROM validation WHERE expire + 86400 < ?`, [ContractUtils.getTimeStamp()]);
    }

    public getUnfinishedJob(): Promise<IValidationData[]> {
        const sql = `SELECT
            requestId, requestPhone, requestAddress, requestNonce, requestSignature, receiver, signature, validationStatus, sendCode, receiveCode, expire, processStep
        FROM
            validation
        WHERE (processStep != ?) AND (processStep != ?) AND (processStep != ?)`;
        return new Promise<IValidationData[]>((resolve, reject) => {
            this.query(sql, [ProcessStep.NONE, ProcessStep.SENT_SMS, ProcessStep.FINISHED])
                .then((rows: any[]) => {
                    const data: IValidationData[] = [];
                    for (const row of rows) {
                        data.push({
                            requestId: row.requestId,
                            requestPhone: row.requestPhone,
                            requestAddress: row.requestAddress,
                            requestNonce: row.requestNonce,
                            requestSignature: row.requestSignature,
                            receiver: row.receiver,
                            signature: row.signature,
                            validationStatus: row.validationStatus,
                            sendCode: row.sendCode,
                            receiveCode: row.receiveCode,
                            expire: row.expire,
                            processStep: row.processStep,
                        });
                    }
                    resolve(data);
                })
                .catch((error) => {
                    reject(error);
                });
        });
    }

    public getValidation(requestId: string): Promise<IValidationData | undefined> {
        const sql = `SELECT
                         requestId, requestPhone, requestAddress, requestNonce, requestSignature, receiver, signature, validationStatus, sendCode, receiveCode, expire, processStep
                     FROM
                         validation
                     WHERE requestId = ?`;
        return new Promise<IValidationData | undefined>((resolve, reject) => {
            this.query(sql, [requestId])
                .then((rows: any[]) => {
                    if (rows.length > 0) {
                        resolve({
                            requestId: rows[0].requestId,
                            requestPhone: rows[0].requestPhone,
                            requestAddress: rows[0].requestAddress,
                            requestNonce: rows[0].requestNonce,
                            requestSignature: rows[0].requestSignature,
                            receiver: rows[0].receiver,
                            signature: rows[0].signature,
                            validationStatus: rows[0].validationStatus,
                            sendCode: rows[0].sendCode,
                            receiveCode: rows[0].receiveCode,
                            expire: rows[0].expire,
                            processStep: rows[0].processStep,
                        });
                    } else {
                        resolve(undefined);
                    }
                })
                .catch((error) => {
                    reject(error);
                });
        });
    }
}
