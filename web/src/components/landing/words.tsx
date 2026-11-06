/** Words wrapped in a mask so the masked reveal can lift them; the text is complete and in place without JS. */
export function Words({ text }: { text: string }) {
  const parts = text.split(/(\s+)/).filter(Boolean)
  return (
    <>
      {parts.map((p, i) =>
        /^\s+$/.test(p) ? (
          " "
        ) : (
          <span key={i} className="lp-w">
            <span data-word>{p}</span>
          </span>
        )
      )}
    </>
  )
}
