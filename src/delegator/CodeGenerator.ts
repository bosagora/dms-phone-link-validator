/**
 * 전화번호 인증에 사용될 랜덤숫자를 생성하는 델리게이트의 인터패이스입니다.
 */
export interface ICodeGenerator {
    setValue(value: number): void;
    getCode(): string;
}

/**
 * 전화번호 인증에 사용될 랜덤숫자를 생성하는 클래스입니다.
 */
export class CodeGenerator implements ICodeGenerator {
    public setValue(value: number) {
        //
    }

    public getCode(): string {
        return Math.floor(Math.random() * 100)
            .toString()
            .padStart(2, "0");
    }
}

/**
 * 테스트에 사용될 고정된 숫자를 생성하는 클래스입니다.
 */
export class FixedCodeGenerator implements ICodeGenerator {
    private code: number;

    constructor(value: number) {
        this.code = value % 100;
    }

    public setValue(value: number) {
        this.code = value % 100;
    }

    public getCode(): string {
        return this.code.toString().padStart(2, "0");
    }
}
