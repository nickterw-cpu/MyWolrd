export async function shareOrDownloadFile(blob, fileName, title) {
  const canCreateShareFile = typeof File === "function" && typeof navigator.share === "function";
  const file = canCreateShareFile ? new File([blob], fileName, { type: blob.type }) : null;
  const canShareFile = file && (!navigator.canShare || navigator.canShare({ files: [file] }));

  if (canShareFile) {
    try {
      await navigator.share({ files: [file], title });
      return "shared";
    } catch (error) {
      if (error?.name === "AbortError") return "cancelled";
    }
  }

  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return "downloaded";
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
