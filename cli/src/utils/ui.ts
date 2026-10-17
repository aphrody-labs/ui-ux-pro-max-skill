/** Minimal terminal helpers: ANSI colors, a spinner and prompts, all with Bun built-ins. */

const useColor = !process.env.NO_COLOR && (process.env.FORCE_COLOR !== undefined || process.stdout.isTTY === true);

function paint(code: string) {
  return (text: string) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text);
}

export const color = {
  bold: paint("1"),
  dim: paint("2"),
  red: paint("31"),
  green: paint("32"),
  yellow: paint("33"),
  blue: paint("34"),
  cyan: paint("36"),
  boldCyan: paint("1;36"),
};

export const logger = {
  info: (msg: string) => console.log(color.blue("info"), msg),
  success: (msg: string) => console.log(color.green("success"), msg),
  warn: (msg: string) => console.log(color.yellow("warn"), msg),
  error: (msg: string) => console.log(color.red("error"), msg),
  title: (msg: string) => console.log(color.boldCyan(`\n${msg}\n`)),
  dim: (msg: string) => console.log(color.dim(msg)),
};

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export class Spinner {
  #text: string;
  #timer: ReturnType<typeof setInterval> | undefined;
  #frame = 0;
  readonly #tty = process.stdout.isTTY === true;

  constructor(text: string) {
    this.#text = text;
  }

  get text(): string {
    return this.#text;
  }

  set text(value: string) {
    this.#text = value;
    if (!this.#tty) console.log(value);
  }

  start(): this {
    if (this.#tty) {
      this.#timer = setInterval(() => {
        process.stdout.write(`\r\x1b[2K${color.cyan(FRAMES[this.#frame++ % FRAMES.length]!)} ${this.#text}`);
      }, 80);
    } else {
      console.log(this.#text);
    }
    return this;
  }

  #stop(symbol: string, text: string): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
    if (this.#tty) process.stdout.write("\r\x1b[2K");
    console.log(`${symbol} ${text}`);
  }

  succeed(text = this.#text): void {
    this.#stop(color.green("✔"), text);
  }

  warn(text = this.#text): void {
    this.#stop(color.yellow("⚠"), text);
  }

  fail(text = this.#text): void {
    this.#stop(color.red("✖"), text);
  }
}

export interface Choice<T> {
  title: string;
  value: T;
}

/** Numbered select prompt. Returns undefined when cancelled or stdin is closed. */
export function select<T>(message: string, choices: Choice<T>[], initial = 0): T | undefined {
  console.log(color.bold(message));
  choices.forEach((choice, index) => {
    const marker = index === initial ? color.cyan("›") : " ";
    console.log(`${marker} ${String(index + 1).padStart(2)}. ${choice.title}`);
  });
  const answer = prompt(`Choose 1-${choices.length}:`, String(initial + 1));
  if (answer === null) return undefined;
  const index = Number.parseInt(answer.trim(), 10) - 1;
  return choices[index]?.value;
}

/** Yes/no prompt, defaulting to "no". */
export function confirmPrompt(message: string): boolean {
  const answer = prompt(`${message} (y/N)`, "");
  return answer !== null && /^y(es)?$/i.test(answer.trim());
}
