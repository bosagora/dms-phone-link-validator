import dotenv from "dotenv";
import { Config } from "./common/Config";
import { logger } from "./common/Logger";
import { Storage } from "./storage/Storages";
import { Utils } from "./utils/Utils";
import { ValidatorNode } from "./validator/ValidatorNode";

dotenv.config({ path: "env/.env" });

let validator: ValidatorNode;

async function main() {
    // Create with the arguments and read from file
    const config = Config.createWithArgument();

    logger.transports.forEach((tp) => {
        tp.level = config.logging.level;
    });

    logger.info({
        validatorIndex: "none",
        method: "main",
        message: `host: ${config.node.host}`,
    });
    logger.info({
        validatorIndex: "none",
        method: "main",
        message: `port: ${config.node.port}`,
    });

    if (config.node.delayLoading > 0) await Utils.delay(config.node.delayLoading);

    Storage.make(config.database.path)
        .then(async (storage: Storage) => {
            validator = new ValidatorNode(config, storage);
            return validator.start().catch((error: any) => {
                // handle specific listen errors with friendly messages
                switch (error.code) {
                    case "EACCES":
                        logger.error({
                            validatorIndex: "none",
                            method: "main",
                            message: `${config.node.port} requires elevated privileges`,
                        });
                        break;
                    case "EADDRINUSE":
                        logger.error({
                            validatorIndex: "none",
                            method: "main",
                            message: `Port ${config.node.port} is already in use`,
                        });
                        break;
                    default:
                        logger.error({
                            validatorIndex: "none",
                            method: "main",
                            message: `An error occurred while starting the server: ${error.stack}`,
                        });
                }
                process.exit(1);
            });
        })
        .catch(() => {
            process.exit(1);
        });
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

process.on("SIGINT", () => {
    validator.stop().then(() => {
        process.exit(0);
    });
});
