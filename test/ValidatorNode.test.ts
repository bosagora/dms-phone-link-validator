import "@nomiclabs/hardhat-ethers";
import "@nomiclabs/hardhat-waffle";
import "@openzeppelin/hardhat-upgrades";
import { ethers, upgrades, waffle } from "hardhat";

import { Config } from "../src/common/Config";
import { Storage } from "../src/storage/Storages";
import { AuthenticationMode, ValidatorNodeInfo } from "../src/types";
import { ContractUtils } from "../src/utils/ContractUtils";
import { PhoneLinkCollection } from "../typechain-types";
import { delay, TestClient, TestValidatorNode } from "./helper/Utility";

import chai, { expect } from "chai";
import { solidity } from "ethereum-waffle";

import assert from "assert";
import ip from "ip";
import * as path from "path";
import URI from "urijs";

chai.use(solidity);

describe("Test of ValidatorNode", function () {
    this.timeout(60 * 1000);
    const provider = waffle.provider;
    const [deployer, validator1, user1, user2, user3] = provider.getWallets();

    const validators = [validator1];
    const users = [user1, user2, user3];
    const phones: string[] = ["+82 10-1234-1000", "+82 10-1234-1001", "+82 10-1234-1002"];
    const phoneHashes: string[] = phones.map((m) => ContractUtils.getPhoneHash(m));
    let linkCollectionContract: PhoneLinkCollection;

    const deployPhoneLinkCollection = async () => {
        const factory = await ethers.getContractFactory("PhoneLinkCollection");
        linkCollectionContract = (await upgrades.deployProxy(
            factory.connect(deployer),
            [validators.map((m) => m.address)],
            {
                initializer: "initialize",
                kind: "uups",
            }
        )) as PhoneLinkCollection;
        await linkCollectionContract.deployed();
    };

    const client = new TestClient();
    let validatorNode: TestValidatorNode;
    let storage: Storage;
    let validatorNodeURL: string;
    let config: Config;

    context("Test ValidatorNode", () => {
        before("Deploy", async () => {
            await deployPhoneLinkCollection();
        });

        before("Create Config", async () => {
            config = new Config();
            config.readFromFile(path.resolve(process.cwd(), "test", "helper", "config.yaml"));
            config.contracts.phoneLinkCollectionAddress = linkCollectionContract.address;
            config.validator.validatorKey = validator1.privateKey;
            config.validator.authenticationMode = AuthenticationMode.NoSMSKnownCode;
        });

        before("Create Storage", async () => {
            storage = await Storage.make(config.database.path);
        });

        before("Create Validator Client", async () => {
            validatorNodeURL = `http://${ip.address()}:${config.node.port}`;
            validatorNode = new TestValidatorNode(config, storage);
        });

        before("Start Validator Client", async () => {
            await validatorNode.start();
        });

        after(async () => {
            await validatorNode.stop();
        });

        it("Get Validator Node Info", async () => {
            const url = URI(validatorNodeURL).filename("info").toString();
            const response = await client.get(url);
            assert.deepStrictEqual(response.data.code, 200);
            const nodeInfo: ValidatorNodeInfo = response.data.data;
            assert.strictEqual(nodeInfo.nodeId, validator1.address.toLowerCase());
            assert.strictEqual(nodeInfo.endpoint, `${config.node.protocol}://${ip.address()}:${config.node.port}`);
        });

        let requestId = "";
        it("Add link data", async () => {
            const nonce = await linkCollectionContract.nonceOf(users[0].address);
            const message = ContractUtils.getRequestPhoneMessage(
                phones[0],
                users[0].address,
                ethers.provider.network.chainId,
                nonce
            );
            const signature = await ContractUtils.signMessage(users[0], message);

            const url = URI(validatorNodeURL).filename("request").toString();
            const response = await client.post(url, {
                phone: phones[0],
                address: users[0].address,
                signature,
            });
            assert.deepStrictEqual(response.status, 200);
            assert.deepStrictEqual(response.data.code, 200);
            assert(response.data.data.requestId !== undefined);
            requestId = response.data.data.requestId;
        });

        it("Wait", async () => {
            await delay(5000);
        });

        it("Vote", async () => {
            await linkCollectionContract.connect(validator1).voteRequest(requestId);
        });

        it("Count", async () => {
            await linkCollectionContract.connect(validator1).countVote(requestId);
        });

        it("Check link data", async () => {
            expect(await linkCollectionContract.toAddress(phoneHashes[0])).to.equal(users[0].address);
            expect(await linkCollectionContract.toPhone(users[0].address)).to.equal(phoneHashes[0]);
        });
    });
});
