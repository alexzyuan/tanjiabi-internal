import assert from "node:assert/strict";
import test from "node:test";

import { readFileAsBase64 } from "../assets/js/file-utils.js";

class SuccessfulFileReader {
  readAsDataURL(file) {
    this.result = `data:${file.type || "application/octet-stream"};base64,${file.base64}`;
    this.onload();
  }
}

class FailingFileReader {
  constructor() {
    this.error = new Error("read failed");
  }

  readAsDataURL() {
    this.onerror();
  }
}

test("file utils read files as base64 payload text", async () => {
  const result = await readFileAsBase64(
    { type: "text/plain", base64: "Zm9v" },
    SuccessfulFileReader,
  );

  assert.equal(result, "Zm9v");
});

test("file utils reject when FileReader fails or is unavailable", async () => {
  await assert.rejects(
    readFileAsBase64({ base64: "Zm9v" }, FailingFileReader),
    /read failed/,
  );
  await assert.rejects(
    readFileAsBase64({ base64: "Zm9v" }, undefined),
    /FileReader is not available/,
  );
});
