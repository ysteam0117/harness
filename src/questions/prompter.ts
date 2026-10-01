import { confirm, isCancel, multiselect, note, select, text, type Option } from "@clack/prompts";

/** 質問の途中で利用者がやめた（Ctrl+C）ことを表す */
export class CancelledError extends Error {
  constructor(message = "質問が中断されました") {
    super(message);
    this.name = "CancelledError";
  }
}

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  hint?: string;
}

/** 入力のやり取りと表示の窓口。本番は @clack/prompts、テストは偽物に差し替える */
export interface Prompter {
  // 入力（利用者に聞く）。id は質問の id（確認などは "confirm_generate"・"accept_warning:<ruleId>"・"fix_question"）
  text(o: {
    id: string;
    message: string;
    placeholder?: string;
    validate?: (v: string) => string | undefined;
  }): Promise<string>;
  select<T extends string>(o: {
    id: string;
    message: string;
    options: SelectOption<T>[];
    initialValue?: T;
  }): Promise<T>;
  multiselect<T extends string>(o: {
    id: string;
    message: string;
    options: SelectOption<T>[];
    required?: boolean;
  }): Promise<T[]>;
  confirm(o: { id: string; message: string; initialValue?: boolean }): Promise<boolean>;
  // 表示（利用者に見せるだけ。入力ではない）
  note(message: string, title?: string): void;
}

function unlessCancelled<T>(value: T | symbol): T {
  if (isCancel(value)) throw new CancelledError();
  return value as T;
}

/** 本番の Prompter（@clack/prompts）。Ctrl+C は CancelledError になる */
export function createClackPrompter(): Prompter {
  return {
    async text(o) {
      const { validate } = o;
      return unlessCancelled<string>(
        await text({
          message: o.message,
          ...(o.placeholder !== undefined ? { placeholder: o.placeholder } : {}),
          ...(validate ? { validate: (v: string | undefined) => validate(v ?? "") } : {}),
        }),
      );
    },
    async select<T extends string>(o: {
      message: string;
      options: SelectOption<T>[];
      initialValue?: T;
    }) {
      return unlessCancelled<T>(
        await select<T>({
          message: o.message,
          options: o.options as Option<T>[],
          ...(o.initialValue !== undefined ? { initialValue: o.initialValue } : {}),
        }),
      );
    },
    async multiselect<T extends string>(o: {
      message: string;
      options: SelectOption<T>[];
      required?: boolean;
    }) {
      return unlessCancelled<T[]>(
        await multiselect<T>({
          message: o.message,
          options: o.options as Option<T>[],
          required: o.required ?? false,
        }),
      );
    },
    async confirm(o) {
      return unlessCancelled<boolean>(
        await confirm({
          message: o.message,
          ...(o.initialValue !== undefined ? { initialValue: o.initialValue } : {}),
        }),
      );
    },
    note(message, title) {
      note(message, title);
    },
  };
}
