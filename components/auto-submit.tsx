"use client";

import { useEffect, useRef } from "react";

/** Inside a GET filter form: any change applies at once, no button to press. */
export function AutoSubmit() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    // Only a field the form sends: a picker's own checkboxes and search box
    // have no name, and ticking one must not reload the page mid-choice.
    const go = (e: Event) => { if ((e.target as HTMLInputElement | null)?.name) form.requestSubmit(); };
    form.addEventListener("change", go);
    return () => form.removeEventListener("change", go);
  }, []);
  return <span ref={ref} hidden />;
}
