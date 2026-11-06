/** Hands a signed URL to the browser as a download (the API signs it with Content-Disposition: attachment). */
export function saveFile(url: string, fileName: string) {
  const a = document.createElement("a")
  a.href = url
  a.download = fileName
  a.rel = "noopener"
  document.body.appendChild(a)
  a.click()
  a.remove()
}
