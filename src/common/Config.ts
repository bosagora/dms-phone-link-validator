import { ArgumentParser } from "argparse";
import extend from "extend";
import fs from "fs";
import path from "path";
import { readYamlEnvSync } from "yaml-env-defaults";
import { Utils } from "../utils/Utils";

export class Config implements IConfig {
    public node: NodeConfig;

    public database: DatabaseConfig;

    public logging: LoggingConfig;

    public validator: ValidatorConfig;

    public contracts: ContractsConfig;

    public sms: SMSConfig;

    constructor() {
        this.node = new NodeConfig();
        this.database = new DatabaseConfig();
        this.logging = new LoggingConfig();
        this.validator = new ValidatorConfig();
        this.contracts = new ContractsConfig();
        this.sms = new SMSConfig();
    }

    public static createWithArgument(): Config {
        // Parse the arguments
        const parser = new ArgumentParser();
        parser.add_argument("-c", "--config", {
            default: "config.yaml",
            help: "Path to the config file to use",
        });
        const args = parser.parse_args();

        let configPath = path.resolve(Utils.getInitCWD(), args.config);
        if (!fs.existsSync(configPath)) configPath = path.resolve(Utils.getInitCWD(), "config", "config.yaml");
        if (!fs.existsSync(configPath)) {
            console.error(`Config file '${configPath}' does not exists`);
            process.exit(1);
        }

        const cfg = new Config();
        try {
            cfg.readFromFile(configPath);
        } catch (error: any) {
            // Logging setup has not been completed and is output to the console.
            console.error(error.message);

            // If the process fails to read the configuration file, the process exits.
            process.exit(1);
        }
        return cfg;
    }

    public readFromFile(config_file: string) {
        const cfg = readYamlEnvSync([path.resolve(Utils.getInitCWD(), config_file)], (key) => {
            return (process.env || {})[key];
        }) as IConfig;
        this.node.readFromObject(cfg.node);
        this.database.readFromObject(cfg.database);
        this.logging.readFromObject(cfg.logging);
        this.validator.readFromObject(cfg.validator);
        this.contracts.readFromObject(cfg.contracts);
        this.sms.readFromObject(cfg.sms);
    }
}

export class NodeConfig implements INodeConfig {
    public protocol: string;
    public host: string;
    public port: number;
    public external: string;
    public delayLoading: number;

    constructor(host?: string, port?: number) {
        const conf = extend(true, {}, NodeConfig.defaultValue());
        extend(true, conf, { host, port });

        this.protocol = conf.protocol;
        this.host = conf.host;
        this.port = Number(conf.port);
        this.external = conf.external;
        this.delayLoading = Number(conf.delayLoading);
    }

    public static defaultValue(): INodeConfig {
        return {
            protocol: "http",
            host: "127.0.0.1",
            port: 3000,
            external: "",
            delayLoading: 0,
        };
    }

    public readFromObject(config: INodeConfig) {
        const conf = extend(true, {}, NodeConfig.defaultValue());
        extend(true, conf, config);

        this.protocol = conf.protocol;
        this.host = conf.host;
        this.port = Number(conf.port);
        this.external = conf.external;
        this.delayLoading = Number(conf.delayLoading);
    }
}

export class DatabaseConfig implements IDatabaseConfig {
    public path: string;

    constructor() {
        const defaults = DatabaseConfig.defaultValue();
        this.path = defaults.path;
    }

    public readFromObject(config: IDatabaseConfig) {
        if (config.path !== undefined) this.path = config.path;
    }

    public static defaultValue(): IDatabaseConfig {
        return {
            path: "./db/validation.db",
        } as unknown as IDatabaseConfig;
    }
}

export class ValidatorConfig implements IValidatorConfig {
    public validatorKey: string;
    public authenticationMode: number;

    constructor() {
        const defaults = ValidatorConfig.defaultValue();

        this.validatorKey = defaults.validatorKey;
        this.authenticationMode = Number(defaults.authenticationMode);
    }

    public static defaultValue(): IValidatorConfig {
        return {
            validatorKey: process.env.VALIDATOR_KEY || "",
            authenticationMode: 3,
        };
    }

    public readFromObject(config: IValidatorConfig) {
        if (config.validatorKey !== undefined) this.validatorKey = config.validatorKey;
        if (config.authenticationMode !== undefined) this.authenticationMode = Number(config.authenticationMode);
    }
}

export class ContractsConfig implements IContractsConfig {
    public phoneLinkCollectionAddress: string;

    constructor() {
        const defaults = ContractsConfig.defaultValue();
        this.phoneLinkCollectionAddress = defaults.phoneLinkCollectionAddress;
    }

    public static defaultValue(): IContractsConfig {
        return {
            phoneLinkCollectionAddress: process.env.PHONE_LINKER_CONTRACT_ADDRESS || "",
        };
    }

    public readFromObject(config: IContractsConfig) {
        if (config.phoneLinkCollectionAddress !== undefined)
            this.phoneLinkCollectionAddress = config.phoneLinkCollectionAddress;
    }
}

export class LoggingConfig implements ILoggingConfig {
    public level: string;

    constructor() {
        const defaults = LoggingConfig.defaultValue();
        this.level = defaults.level;
    }

    public static defaultValue(): ILoggingConfig {
        return {
            level: "info",
        };
    }

    public readFromObject(config: ILoggingConfig) {
        if (config.level) this.level = config.level;
    }
}

export class SMSConfig implements ISMSConfig {
    public endpoint: string;
    public accessKey: string;

    constructor() {
        const defaults = SMSConfig.defaultValue();
        this.endpoint = defaults.endpoint;
        this.accessKey = defaults.accessKey;
    }

    public static defaultValue(): ISMSConfig {
        return {
            endpoint: process.env.SMS_ENDPOINT || "",
            accessKey: process.env.SMS_ACCESSKEY || "",
        };
    }

    public readFromObject(config: ISMSConfig) {
        if (config.endpoint !== undefined) this.endpoint = config.endpoint;
        if (config.accessKey !== undefined) this.accessKey = config.accessKey;
    }
}
export interface INodeConfig {
    protocol: string;
    host: string;
    port: number;
    external: string;
    delayLoading: number;
}

export interface IDatabaseConfig {
    path: string;
}

export interface ILoggingConfig {
    level: string;
}

export interface IValidatorConfig {
    validatorKey: string;
    authenticationMode: number;
}

export interface IContractsConfig {
    phoneLinkCollectionAddress: string;
}

export interface ISMSConfig {
    endpoint: string;
    accessKey: string;
}

export interface IConfig {
    node: INodeConfig;
    database: IDatabaseConfig;
    logging: ILoggingConfig;
    validator: IValidatorConfig;
    contracts: IContractsConfig;
    sms: ISMSConfig;
}
