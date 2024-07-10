import axios from "axios";
// tslint:disable-next-line:no-var-requires
import * as dotenv from "dotenv";
dotenv.config({ path: "env/.env" });

async function main() {
    const contents: string[] = [];
    const validatorNumber: string = `${1}`;
    contents.push(`검증자 번호 [${validatorNumber}]`);
    contents.push(`인증번호 [${25}]. `);
    contents.push(`5분가 유효합니다.`);
    console.log(process.env.SMS_ACCESSKEY || "");
    console.log(process.env.SMS_RECEIVER || "");

    const data = {
        accessKey: process.env.SMS_ACCESSKEY || "",
        receiver: process.env.SMS_RECEIVER || "",
        msg: contents.map((m) => m + "\n").join("\n"),
    };
    const client = axios.create();

    const res = await client.post(process.env.SMS_ENDPOINT || "", data);
    console.log(res.data);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
