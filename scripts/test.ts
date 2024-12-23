import { ContractUtils } from "../src/utils/ContractUtils";
import { Utils } from "../src/utils/Utils";
import { PhoneLinkCollection } from "../typechain-types";

import "@nomiclabs/hardhat-ethers";
import * as hre from "hardhat";

import axios from "axios";
import URI from "urijs";

const validatorNodeURL = "http://localhost:7080";

interface IUserData {
    phone: string;
    address: string;
    privateKey: string;
}

const userData: IUserData[] = [
    {
        phone: "01010009000",
        address: "0xa4Eb53ed77203894b68bFB27B50B0676A8Dec185",
        privateKey: "0xc514a04e72dd7b3967197f985b55978393fb12593b59d7c08eb2f396826f3cf2",
    },
    {
        phone: "01010009001",
        address: "0x0229Dd332125fF89914Da64Be60ea99259A86B19",
        privateKey: "0x530bc7a4fde2b161bd85ccd14323121acbbfc7ec877fb007a69c1adae56afbf1",
    },
    {
        phone: "01010009002",
        address: "0x28d150a939e7348597BF35cA3588261456c6Ab74",
        privateKey: "0xb6585fdce92cedce47cd7c9b13c8159cd5536549c58730dd8c4da602f3daa16c",
    },
    {
        phone: "01010009003",
        address: "0xF01BA1A09487e4F2C8dbD2122A8C1cbdA36aF631",
        privateKey: "0x4a2656ed4b84ea34f25a83f005198b71510016d0606ba5c7a101b950057a5359",
    },
    {
        phone: "01010009004",
        address: "0xafFe745418Ad24c272175e5B58610A8a35e2EcDa",
        privateKey: "0xa237d68cbb66fd5f76e7b321156c46882546ad87d662dec8b82703ac31efbf0a",
    },
];
async function getContract(): Promise<PhoneLinkCollection> {
    const factory = await hre.ethers.getContractFactory("PhoneLinkCollection");
    return (await factory.attach(process.env.PHONE_LINK_COLLECTION_ADDRESS || "")) as PhoneLinkCollection;
}

async function request(user: IUserData): Promise<string> {
    const contract = await getContract();
    const nonce = await contract.nonceOf(user.address);
    const message = ContractUtils.getRequestPhoneMessage(user.phone, user.address, hre.ethers.provider.network.chainId, nonce);
    const signature = await ContractUtils.signMessage(new hre.ethers.Wallet(user.privateKey), message);

    const url = URI(validatorNodeURL).filename("request").toString();
    const client = axios.create();
    const response = await client.post(url, {
        phone: user.phone,
        address: user.address,
        signature,
    });
    console.log(response.data);

    return response.data.data.requestId;
}

async function submit(requestId: string) {
    const code = "000102";

    const client = axios.create();
    const url = URI(validatorNodeURL).filename("submit").toString();
    const response = await client.post(url, { requestId, code });
    console.log(response.data);
}

async function check(user: IUserData) {
    const userPhoneHash = ContractUtils.getPhoneHash(user.phone);
    const contract = await getContract();
    const resAddress = await contract.toAddress(userPhoneHash);

    if (resAddress === user.address) {
        console.log("Success");
    } else {
        console.log("User address :", user.address);
        console.log("Registered address :", resAddress);
    }

    const resPhone = await contract.toPhone(user.address);
    if (resPhone === userPhoneHash) {
        console.log("Success");
    } else {
        console.log("User phone :", userPhoneHash);
        console.log("Registered phone :", resPhone);
    }
}

async function main() {
    for (const user of userData) {
        const requestId = await request(user);
        await Utils.delay(5000);
        await submit(requestId);
        await Utils.delay(10000);
        await check(user);
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
