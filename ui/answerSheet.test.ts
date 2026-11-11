// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginComposerApi } from "@get-bb/plugin-sdk/app";
import { AnswerSheet, type SheetEntry } from "./answerSheet";

/** Vitest's jsdom environment exposes the JSDOM instance; only its window is used here. */
declare const jsdom: { window: Window & typeof globalThis };

const KEY = "bb.genui.sheet:thr_windows";

function entry(block: string, text: string): Omit<SheetEntry, "seq"> {
  return { block, question: "q", message: "m", reply: 0, fence: 0, position: 0, text, selection: text };
}

beforeEach(() => {
  // Node 25+ has its own global localStorage (undefined without --localstorage-file), which hides jsdom's.
  vi.stubGlobal("localStorage", jsdom.window.localStorage);
  localStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe("two windows on one thread", () => {
  it("never answer each other's writes: no write follows another window's, the last writer wins", () => {
    const one = new AnswerSheet(KEY);
    const two = new AnswerSheet(KEY);
    const setItem = vi.spyOn(jsdom.window.Storage.prototype, "setItem");
    one.stage(entry("a", "Pro"));
    expect(setItem).toHaveBeenCalledTimes(1);
    // What the browser does for every other window when one writes the key.
    window.dispatchEvent(new StorageEvent("storage", { key: KEY, newValue: localStorage.getItem(KEY) }));
    expect(setItem).toHaveBeenCalledTimes(1);
    expect([...two.snapshot("a").staged.keys()]).toEqual([]);
    two.stage(entry("b", "Basic"));
    window.dispatchEvent(new StorageEvent("storage", { key: KEY, newValue: localStorage.getItem(KEY) }));
    expect(setItem).toHaveBeenCalledTimes(2);
    // A fresh page reads the last write.
    const fresh = new AnswerSheet(KEY);
    expect([...fresh.snapshot("a").staged.keys()]).toEqual([]);
    expect([...fresh.snapshot("b").staged.values()].map((item) => item.text)).toEqual(["Basic"]);
    setItem.mockRestore();
  });
});

describe("focus after a pick", () => {
  function composer() {
    return {
      draft: { text: "", mentions: [], attachments: [] },
      isSubmitting: false,
      replace: vi.fn(),
      focus: vi.fn(),
      onSubmitted: () => () => undefined,
    } as unknown as PluginComposerApi & { focus: ReturnType<typeof vi.fn> };
  }

  function focused(html: string): HTMLElement {
    document.body.innerHTML = html;
    const element = document.body.firstElementChild as HTMLElement;
    element.focus();
    return element;
  }

  it("goes to the composer after a button or radio, so Enter sends", () => {
    const sheet = new AnswerSheet(null);
    const one = composer();
    sheet.attach(one);
    focused("<button>Pro</button>");
    sheet.focusComposer();
    focused('<input type="radio">');
    sheet.focusComposer();
    expect(one.focus).toHaveBeenCalledTimes(2);
  });

  it("stays in a text field, a slider or an app's frame", () => {
    const sheet = new AnswerSheet(null);
    const one = composer();
    sheet.attach(one);
    for (const html of ['<input type="text">', '<input type="range">', "<textarea></textarea>", '<span role="slider" tabindex="0"></span>', "<iframe></iframe>"]) {
      focused(html);
      sheet.focusComposer();
    }
    expect(one.focus).not.toHaveBeenCalled();
  });
});
