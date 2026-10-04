import { NextResponse, type NextRequest } from "next/server";
import { userForToken, permissionForPath, can, SESSION_COOKIE } from "@/lib/auth-core";

// Every request is signed in or sent to /login, and every page is checked
// against the role's permissions here, on the server, before it renders.
// Server actions post to the page they came from, so they pass this gate too
// — and each one checks its own permission again (lib/actions.ts).

const PUBLIC = ["/login", "/setup"];

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  // The layout needs the path to know which shell to draw; headers are the
  // only channel from here to a server component.
  const headers = new Headers(req.headers);
  headers.set("x-pathname", path);
  if (PUBLIC.some((p) => path === p || path.startsWith(p + "/"))) {
    return NextResponse.next({ request: { headers } });
  }

  const user = await userForToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!user) {
    const to = req.nextUrl.clone();
    to.pathname = "/login";
    to.search = path === "/" ? "" : `?next=${encodeURIComponent(path)}`;
    return NextResponse.redirect(to);
  }

  const need = permissionForPath(path);
  if (need && !can(user, need)) {
    const to = req.nextUrl.clone();
    to.pathname = "/";
    to.search = `?denied=${encodeURIComponent(need)}`;
    return NextResponse.redirect(to);
  }

  return NextResponse.next({ request: { headers } });
}

export const config = {
  runtime: "nodejs",
  // Everything but Next's own assets and files with an extension (fonts,
  // icons). Item photos are served by a route and so are covered.
  matcher: ["/((?!_next/|favicon.ico|.*\\.[a-z0-9]+$).*)"],
};
