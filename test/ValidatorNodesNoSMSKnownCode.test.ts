import "@nomiclabs/hardhat-ethers";
import "@nomiclabs/hardhat-waffle";
import "@openzeppelin/hardhat-upgrades";
import { ethers, upgrades, waffle } from "hardhat";

import { Config } from "../src/common/Config";
import { Storage } from "../src/storage/Storages";
import { AuthenticationMode, ValidatorNodeInfo } from "../src/types";
import { ContractUtils } from "../src/utils/ContractUtils";
import { PeerStatus } from "../src/validator/Peers";
import { ValidatorNode } from "../src/validator/ValidatorNode";
import { PhoneLinkCollection } from "../typechain-types";
import { delay, TestClient, TestValidatorNode } from "./helper/Utility";

import chai, { expect } from "chai";
import { solidity } from "ethereum-waffle";

import assert from "assert";
import ip from "ip";
import * as path from "path";
import URI from "urijs";

chai.use(solidity);

describe("Test of ValidatorNode - NoSMSKnownCode", function () {
    this.timeout(60 * 1000);
    const provider = waffle.provider;
    const [deployer, validator1, validator2, validator3, user1, user2, user3] = provider.getWallets();

    const validators = [validator1, validator2, validator3];
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

    const validatorNodes: TestValidatorNode[] = [];
    const storages: Storage[] = [];
    const validatorNodeURLs: string[] = [];
    const configs: Config[] = [];
    const maxValidatorCount = 3;
    const client = new TestClient();
    const basePort = 9020;

    context("Test ValidatorNode", () => {
        before("Deploy", async () => {
            await deployPhoneLinkCollection();
        });

        before("Create Config", async () => {
            for (let idx = 0; idx < maxValidatorCount; idx++) {
                const config = new Config();
                config.readFromFile(path.resolve(process.cwd(), "test", "helper", "config.yaml"));
                config.contracts.phoneLinkCollectionAddress = linkCollectionContract.address;
                config.validator.validatorKey = validators[idx].privateKey;
                config.validator.authenticationMode = AuthenticationMode.NoSMSKnownCode;
                config.node.protocol = "http";
                config.node.host = "0.0.0.0";
                config.node.port = basePort + idx;
                configs.push(config);

                await linkCollectionContract
                    .connect(validators[idx])
                    .updateEndpoint(`http://${ip.address()}:${basePort + idx}`);
            }
        });

        before("Create Storages", async () => {
            for (let idx = 0; idx < maxValidatorCount; idx++) {
                storages.push(await Storage.make(configs[idx].database.path));
            }
        });

        before("Create Validator Nodes", async () => {
            for (let idx = 0; idx < maxValidatorCount; idx++) {
                validatorNodeURLs.push(`http://${ip.address()}:${configs[idx].node.port}`);
                validatorNodes.push(new TestValidatorNode(configs[idx], storages[idx]));
            }
        });

        before("Start Validator Nodes", async () => {
            for (let idx = 0; idx < maxValidatorCount; idx++) {
                await validatorNodes[idx].start();
            }
        });

        after(async () => {
            for (let idx = 0; idx < maxValidatorCount; idx++) {
                await validatorNodes[idx].stop();
            }
        });

        it("Get Validator Node Info", async () => {
            for (let idx = 0; idx < maxValidatorCount; idx++) {
                const url = URI(validatorNodeURLs[idx]).filename("info").toString();
                const response = await client.get(url);
                assert.deepStrictEqual(response.data.code, 200);
                const nodeInfo: ValidatorNodeInfo = response.data.data;
                assert.strictEqual(nodeInfo.nodeId, validators[idx].address.toLowerCase());
                assert.strictEqual(nodeInfo.endpoint, `http://${ip.address()}:${configs[idx].node.port}`);
            }
        });

        it("Wait", async () => {
            await delay(ValidatorNode.INIT_WAITING_SECONDS * 2000);
        });

        it("Get Validator Node Peers", async () => {
            for (let idx = 0; idx < maxValidatorCount; idx++) {
                const peers = [];
                for (let peerIdx = 0; peerIdx < maxValidatorCount; peerIdx++) {
                    if (idx === peerIdx) continue;
                    peers.push({
                        nodeId: validators[peerIdx].address.toLowerCase(),
                        endpoint: `http://${ip.address()}:${basePort + peerIdx}`,
                    });
                }
                const url = URI(validatorNodeURLs[idx]).filename("peers").toString();
                const response = await client.get(url);
                const expected = [
                    {
                        nodeId: peers[0].nodeId,
                        endpoint: peers[0].endpoint,
                        version: "v1.0.0",
                        status: PeerStatus.ACTIVE,
                    },
                    {
                        nodeId: peers[1].nodeId,
                        endpoint: peers[1].endpoint,
                        version: "v1.0.0",
                        status: PeerStatus.ACTIVE,
                    },
                ];
                assert.deepStrictEqual(response.data.data, expected);
            }
        });

        it("Check validator's endpoint on contract", async () => {
            for (let idx = 0; idx < maxValidatorCount; idx++) {
                const res = await linkCollectionContract.getValidator(idx);
                assert.deepStrictEqual(res.index.toString(), `${idx}`);
                assert.deepStrictEqual(res.endpoint, `http://${ip.address()}:${basePort + idx}`);
            }
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

            const url = URI(validatorNodeURLs[0]).filename("request").toString();
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
            await delay(3000);
        });

        it("Submit", async () => {
            const url = URI(validatorNodeURLs[0]).filename("submit").toString();
            const response = await client.post(url, { requestId, code: "000102" });
            assert.strictEqual(response.data.data, "OK");
        });

        it("Wait", async () => {
            await delay(5000);
        });

        it("Check link data", async () => {
            expect(await linkCollectionContract.toAddress(phoneHashes[0])).to.equal(users[0].address);
            expect(await linkCollectionContract.toPhone(users[0].address)).to.equal(phoneHashes[0]);
        });
    });
});
