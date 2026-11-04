"use client";

import { useEffect, useRef } from "react";

/** Inside a GET filter form: any change applies at once, no button to press. */
export function AutoSubmit() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const go = () => form.requestSubmit();
    form.addEventListener("change", go);
    return () => form.removeEventListener("change", go);
  }, []);
  return <span ref={ref} hidden />;
}
