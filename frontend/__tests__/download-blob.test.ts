import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { downloadBlob, BLOB_URL_REVOKE_DELAY_MS } from "@/lib/download-blob";

const createObjectURL = vi.fn(() => "blob:mock-url");
const revokeObjectURL = vi.fn();

describe("downloadBlob", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    // jsdom implements neither of these.
    Object.assign(URL, { createObjectURL, revokeObjectURL });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("attaches the anchor to the document before clicking it", () => {
    let connectedAtClick = false;
    const clickSpy = vi
      .spyOn(HTMLElement.prototype, "click")
      .mockImplementation(function (this: HTMLElement) {
        connectedAtClick = this.isConnected;
      });

    downloadBlob(new Blob(["a,b"], { type: "text/csv" }), "cases.csv");

    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(connectedAtClick).toBe(true);
    clickSpy.mockRestore();
  });

  it("removes the anchor again once the click has been dispatched", () => {
    const clickSpy = vi
      .spyOn(HTMLElement.prototype, "click")
      .mockImplementation(() => {});

    downloadBlob(new Blob(["x"]), "x.txt");

    expect(document.querySelectorAll("a[download]")).toHaveLength(0);
    clickSpy.mockRestore();
  });

  it("does not revoke the object URL in the same task as the click", () => {
    const clickSpy = vi
      .spyOn(HTMLElement.prototype, "click")
      .mockImplementation(() => {});

    downloadBlob(new Blob(["x"]), "x.txt");

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).not.toHaveBeenCalled();

    vi.advanceTimersByTime(BLOB_URL_REVOKE_DELAY_MS);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
    clickSpy.mockRestore();
  });

  it("still detaches and revokes when click() throws", () => {
    const clickSpy = vi
      .spyOn(HTMLElement.prototype, "click")
      .mockImplementation(() => {
        throw new Error("blocked");
      });

    expect(() => downloadBlob(new Blob(["x"]), "x.txt")).toThrow("blocked");
    expect(document.querySelectorAll("a[download]")).toHaveLength(0);

    vi.advanceTimersByTime(BLOB_URL_REVOKE_DELAY_MS);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
    clickSpy.mockRestore();
  });
});
