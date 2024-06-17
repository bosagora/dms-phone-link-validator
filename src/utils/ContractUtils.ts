import { ISubmitData, ITransaction } from "../types";

// tslint:disable-next-line:no-implicit-dependencies
import { defaultAbiCoder, Interface } from "@ethersproject/abi";
// tslint:disable-next-line:no-implicit-dependencies
import { Signer } from "@ethersproject/abstract-signer";
// tslint:disable-next-line:no-implicit-dependencies
import { BigNumber, BigNumberish } from "@ethersproject/bignumber";
// tslint:disable-next-line:no-implicit-dependencies
import { arrayify, BytesLike } from "@ethersproject/bytes";
// tslint:disable-next-line:no-implicit-dependencies
import { AddressZero } from "@ethersproject/constants";
// tslint:disable-next-line:no-implicit-dependencies
import { ContractReceipt, ContractTransaction } from "@ethersproject/contracts";
// tslint:disable-next-line:no-implicit-dependencies
import { id } from "@ethersproject/hash";
// tslint:disable-next-line:no-implicit-dependencies
import { keccak256 } from "@ethersproject/keccak256";
// tslint:disable-next-line:no-implicit-dependencies
import { Log } from "@ethersproject/providers";
// tslint:disable-next-line:no-implicit-dependencies
import { randomBytes } from "@ethersproject/random";
// tslint:disable-next-line:no-implicit-dependencies
import { verifyMessage } from "@ethersproject/wallet";

export class ContractUtils {
    public static NullAddress = "0x0000000000000000000000000000000000000000";
    public static NullBytes32 = "0x0000000000000000000000000000000000000000000000000000000000000000";

    public static StringToBuffer(hex: string): Buffer {
        const start = hex.substring(0, 2) === "0x" ? 2 : 0;
        return Buffer.from(hex.substring(start), "hex");
    }

    public static BufferToString(data: Buffer): string {
        return "0x" + data.toString("hex");
    }

    public static getTimeStamp(): number {
        return Math.floor(new Date().getTime() / 1000);
    }

    public static getPhoneHash(phone: string): string {
        const encodedResult = defaultAbiCoder.encode(["string", "string"], ["BOSagora Phone Number", phone]);
        return keccak256(encodedResult);
    }

    public static getEmailHash(phone: string): string {
        const encodedResult = defaultAbiCoder.encode(["string", "string"], ["BOSagora Email", phone]);
        return keccak256(encodedResult);
    }

    public static getRequestId(hash: string, address: string, nonce: BigNumberish): string {
        const encodedResult = defaultAbiCoder.encode(
            ["bytes32", "address", "uint256", "bytes32"],
            [hash, address, nonce, randomBytes(32)]
        );
        return keccak256(encodedResult);
    }

    public static getRequestMessage(
        hash: string,
        address: string,
        chainId: BigNumberish,
        nonce: BigNumberish
    ): Uint8Array {
        const encodedResult = defaultAbiCoder.encode(
            ["bytes32", "address", "uint256", "uint256"],
            [hash, address, chainId, nonce]
        );
        return arrayify(keccak256(encodedResult));
    }

    public static getRemoveMessage(address: string, chainId: BigNumberish, nonce: BigNumberish): Uint8Array {
        const encodedResult = defaultAbiCoder.encode(["address", "uint256", "uint256"], [address, chainId, nonce]);
        return arrayify(keccak256(encodedResult));
    }

    public static getRequestPhoneMessage(
        phone: string,
        address: string,
        chainId: BigNumberish,
        nonce: BigNumberish
    ): Uint8Array {
        const encodedResult = defaultAbiCoder.encode(
            ["bytes32", "address", "uint256", "uint256"],
            [ContractUtils.getPhoneHash(phone), address, chainId, nonce]
        );
        return arrayify(keccak256(encodedResult));
    }

    public static getRequestEmailMessage(
        email: string,
        address: string,
        chainId: BigNumberish,
        nonce: BigNumberish
    ): Uint8Array {
        const encodedResult = defaultAbiCoder.encode(
            ["bytes32", "address", "uint256", "uint256"],
            [ContractUtils.getEmailHash(email), address, chainId, nonce]
        );
        return arrayify(keccak256(encodedResult));
    }

    public static getTxMessage(tx: ITransaction, chainId: BigNumberish): Uint8Array {
        const encodedResult = defaultAbiCoder.encode(
            ["bytes32", "address", "uint256", "bytes32", "address", "uint256"],
            [
                ContractUtils.getPhoneHash(tx.request.phone),
                tx.request.address,
                tx.request.nonce,
                tx.requestId,
                tx.receiver,
                chainId,
            ]
        );
        return arrayify(keccak256(encodedResult));
    }

    public static getSubmitMessage(data: ISubmitData, chainId: BigNumberish): Uint8Array {
        const encodedResult = defaultAbiCoder.encode(
            ["bytes32", "string", "address", "uint256"],
            [data.requestId, data.code, data.receiver, chainId]
        );
        return arrayify(keccak256(encodedResult));
    }

    public static async signMessage(signer: Signer, message: Uint8Array): Promise<string> {
        return signer.signMessage(message);
    }

    public static verifyMessage(address: string, message: Uint8Array, signature: string): boolean {
        let res: string;
        try {
            res = verifyMessage(message, signature);
        } catch (error) {
            return false;
        }
        return res.toLowerCase() === address.toLowerCase();
    }
}
