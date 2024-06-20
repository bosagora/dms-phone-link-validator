import "@nomiclabs/hardhat-ethers";
import "@nomiclabs/hardhat-waffle";
import "@openzeppelin/hardhat-upgrades";
import "@typechain/hardhat";
import "hardhat-gas-reporter";
import "solidity-coverage";
import "solidity-docgen";

import * as dotenv from "dotenv";
import { Wallet } from "ethers";

dotenv.config({ path: "env/.env" });

// tslint:disable-next-line:no-var-requires
const secureEnv = require("secure-env");
import extend from "extend";

import { HardhatAccount } from "./src/HardhatAccount";

function getAccounts() {
    if (HardhatAccount.keys.length !== 0) return HardhatAccount.keys;
    console.log(`Wallet file name: ${process.env.WALLET_ENV}`);
    process.env = extend(
        true,
        process.env,
        secureEnv({ path: process.env.WALLET_ENV, secret: process.env.WALLET_SECRET })
    );
    const accounts: string[] = [];
    const reg_bytes64: RegExp = /^(0x)[0-9a-f]{64}$/i;
    if (
        process.env.DEPLOYER_SIDE_CHAIN !== undefined &&
        process.env.DEPLOYER_SIDE_CHAIN.trim() !== "" &&
        reg_bytes64.test(process.env.DEPLOYER_SIDE_CHAIN)
    ) {
        accounts.push(process.env.DEPLOYER_SIDE_CHAIN);
    } else {
        process.env.DEPLOYER_SIDE_CHAIN = Wallet.createRandom().privateKey;
        accounts.push(process.env.DEPLOYER_SIDE_CHAIN);
    }

    if (process.env.OWNER !== undefined && process.env.OWNER.trim() !== "" && reg_bytes64.test(process.env.OWNER)) {
        accounts.push(process.env.OWNER);
    } else {
        process.env.OWNER = Wallet.createRandom().privateKey;
        accounts.push(process.env.OWNER);
    }

    if (
        process.env.LINK_VALIDATOR1 !== undefined &&
        process.env.LINK_VALIDATOR1.trim() !== "" &&
        reg_bytes64.test(process.env.LINK_VALIDATOR1)
    ) {
        accounts.push(process.env.LINK_VALIDATOR1);
    } else {
        process.env.LINK_VALIDATOR1 = Wallet.createRandom().privateKey;
        accounts.push(process.env.LINK_VALIDATOR1);
    }

    if (
        process.env.LINK_VALIDATOR2 !== undefined &&
        process.env.LINK_VALIDATOR2.trim() !== "" &&
        reg_bytes64.test(process.env.LINK_VALIDATOR2)
    ) {
        accounts.push(process.env.LINK_VALIDATOR2);
    } else {
        process.env.LINK_VALIDATOR2 = Wallet.createRandom().privateKey;
        accounts.push(process.env.LINK_VALIDATOR2);
    }

    if (
        process.env.LINK_VALIDATOR3 !== undefined &&
        process.env.LINK_VALIDATOR3.trim() !== "" &&
        reg_bytes64.test(process.env.LINK_VALIDATOR3)
    ) {
        accounts.push(process.env.LINK_VALIDATOR3);
    } else {
        process.env.LINK_VALIDATOR3 = Wallet.createRandom().privateKey;
        accounts.push(process.env.LINK_VALIDATOR3);
    }

    while (accounts.length < 12) {
        accounts.push(Wallet.createRandom().privateKey);
    }

    for (const account of accounts) {
        HardhatAccount.keys.push(account);
    }

    return HardhatAccount.keys;
}

function getTestAccounts() {
    const defaultBalance = "2000000000000000000000000";
    const acc = getAccounts();
    return acc.map((m) => {
        return {
            privateKey: m,
            balance: defaultBalance,
        };
    });
}

const config = {
    solidity: {
        compilers: [
            {
                version: "0.8.2",
                settings: {
                    optimizer: {
                        enabled: true,
                        runs: 2000,
                    },
                },
            },
        ],
    },
    defaultNetwork: "hardhat",
    networks: {
        hardhat: {
            accounts: getTestAccounts(),
            gas: 8000000,
            gasPrice: 8000000000,
            blockGasLimit: 8000000,
        },
        bosagora_mainnet: {
            url: process.env.MAIN_NET_URL || "",
            chainId: 2151,
            accounts: getAccounts(),
        },
        bosagora_testnet: {
            url: process.env.TEST_NET_URL || "",
            chainId: 2019,
            accounts: getAccounts(),
        },
        bosagora_devnet: {
            url: "http://localhost:8545",
            chainId: 24680,
            accounts: getAccounts(),
        },
        production_net: {
            url: process.env.PRODUCTION_NET_URL || "",
            chainId: Number(process.env.PRODUCTION_CHAIN_ID || "2151"),
            accounts: getAccounts(),
            deploy: [],
        },
    },
    gasReporter: {
        enabled: process.env.REPORT_GAS !== undefined,
        currency: "USD",
    },
};

export default config;
