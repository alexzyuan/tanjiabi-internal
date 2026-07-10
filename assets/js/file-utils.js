export function readFileAsBase64(file, FileReaderApi = globalThis.FileReader) {
  return new Promise((resolve, reject) => {
    if (typeof FileReaderApi !== "function") {
      reject(new Error("FileReader is not available."));
      return;
    }

    const reader = new FileReaderApi();
    reader.onload = () => resolve(String(reader.result).split(",").pop());
    reader.onerror = () => reject(reader.error || new Error("Failed to read file."));
    reader.readAsDataURL(file);
  });
}
