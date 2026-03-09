import { getServerSession } from "next-auth/next";
import { authOptions } from "../../pages/api/auth/[...nextauth]";

export function getSession(req, res) {
  return getServerSession(req, res, authOptions);
}
