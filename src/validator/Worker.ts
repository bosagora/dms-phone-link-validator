import * as cron from "node-cron";
import { logger } from "../common/Logger";
import { Router } from "./Router";
import { ValidatorNode } from "./ValidatorNode";

export enum WorkerState {
    NONE = 0,
    STARTING = 2,
    RUNNING = 3,
    STOPPING = 4,
    STOPPED = 5,
}

export class Worker {
    protected task: cron.ScheduledTask | null = null;
    private readonly _validator: ValidatorNode;
    private readonly _router: Router;

    protected state: WorkerState;

    protected expression: string;

    private is_working: boolean = false;

    constructor(expression: string, validator: ValidatorNode, router: Router) {
        this._validator = validator;
        this._router = router;
        this.expression = expression;
        this.state = WorkerState.NONE;
    }

    public async start() {
        this.state = WorkerState.STARTING;
        this.is_working = false;
        this.task = cron.schedule(this.expression, this.workTask.bind(this));
        this.state = WorkerState.RUNNING;
        await this.onStart();
    }

    public async onStart() {
        //
    }

    public async stop() {
        this.state = WorkerState.STOPPING;

        if (!this.is_working) {
            this.state = WorkerState.STOPPED;
        }

        await this.onStop();
    }

    public async onStop() {
        //
    }

    private stopTask() {
        if (this.task !== null) {
            this.task.stop();
            this.task = null;
        }
    }

    public waitForStop(timeout: number = 60000): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
            const start = Math.floor(new Date().getTime() / 1000);
            const wait = () => {
                if (this.state === WorkerState.STOPPED) {
                    this.stopTask();
                    resolve(true);
                } else {
                    const now = Math.floor(new Date().getTime() / 1000);
                    if (now - start < timeout) setTimeout(wait, 10);
                    else {
                        this.stopTask();
                        resolve(false);
                    }
                }
            };
            wait();
        });
    }

    public isRunning(): boolean {
        return this.task !== null;
    }

    public isWorking(): boolean {
        return this.is_working;
    }

    private async workTask() {
        if (this.state === WorkerState.STOPPED) return;
        if (this.is_working) return;

        this.is_working = true;
        try {
            await this.work();
        } catch (error) {
            logger.error({
                validatorIndex: "none",
                method: "Worker.workTask()",
                message: `Failed to execute a scheduler: ${error}`,
            });
        }
        this.is_working = false;

        if (this.state === WorkerState.STOPPING) {
            this.state = WorkerState.STOPPED;
        }
    }

    protected async work() {
        await this._router.onWork();
    }
}
