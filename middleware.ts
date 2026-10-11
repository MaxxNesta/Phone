import { NextResponse, type NextRequest } from "next/server";
import { userForToken, permissionForPath, can, SESSION_COOKIE, authRequired } from "@/lib/auth-core";

// Every request is signed in or sent to /login, and every page is checked
// against the role's permissions here, on the server, before it renders.
// Server actions post to the page they came from, so they pass this gate too
// — and each one checks its own permission again (lib/actions.ts).

const PUBLIC = ["/login", "/setup"];

/**
 * The page may run only the scripts this response vouches for: Next's own,
 * carrying the nonce, and what they load ('strict-dynamic'). An injected
 * <script> — the payload of any XSS — has no nonce and does not run.
 *
 * Styles allow inline: React writes style attributes, which a nonce cannot
 * cover. Images may come from the photo bucket. Nothing may frame the app,
 * and forms post only to it.
 */
function contentSecurityPolicy(nonce: string) {
  const dev = process.env.NODE_ENV !== "production";
  let photos = "";
  try { photos = process.env.R2_PUBLIC_BASE_URL ? new URL(process.env.R2_PUBLIC_BASE_URL).origin : ""; } catch {}
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${photos ? " " + photos : ""}`,
    "font-src 'self'",
    `connect-src 'self'${dev ? " ws:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  // The layout needs the path to know which shell to draw; headers are the
  // only channel from here to a server component.
  const headers = new Headers(req.headers);
  headers.set("x-pathname", path);
  // Next reads the policy from the request to put the nonce on its scripts;
  // the root layout reads x-nonce for its one inline script.
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = contentSecurityPolicy(nonce);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", csp);
  const withCsp = (res: NextResponse) => { res.headers.set("Content-Security-Policy", csp); return res; };
  // Sign-in switched off: no login page, everyone acts as the owner.
  if (!authRequired()) {
    if (path === "/login") return withCsp(NextResponse.redirect(new URL("/", req.url)));
    return withCsp(NextResponse.next({ request: { headers } }));
  }
  if (PUBLIC.some((p) => path === p || path.startsWith(p + "/"))) {
    return withCsp(NextResponse.next({ request: { headers } }));
  }

  const user = await userForToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!user) {
    const to = req.nextUrl.clone();
    to.pathname = "/login";
    to.search = path === "/" ? "" : `?next=${encodeURIComponent(path)}`;
    return withCsp(NextResponse.redirect(to));
  }

  const need = permissionForPath(path);
  if (need && !can(user, need)) {
    const to = req.nextUrl.clone();
    to.pathname = "/";
    to.search = `?denied=${encodeURIComponent(need)}`;
    return withCsp(NextResponse.redirect(to));
  }

  return withCsp(NextResponse.next({ request: { headers } }));
}

export const config = {
  runtime: "nodejs",
  // Everything but Next's own assets and files with an extension (fonts,
  // icons). Item photos are served by a route and so are covered.
  matcher: ["/((?!_next/|favicon.ico|.*\\.[a-z0-9]+$).*)"],
};
