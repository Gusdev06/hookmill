import { notFound } from "next/navigation"

/** QA layout 29/10 #14: an unknown URL of a signed-in person falls here, so the 404 keeps the app shell (sidebar, top bar). */
export default function Missing() {
  notFound()
}
