import { type NextApiRequest, type NextApiResponse } from "next";
import { z } from "zod";
import { cors, runMiddleware } from "@/src/features/publicApi/server/cors";
import { prisma } from "@/src/server/db";
import { verifyAuthHeaderAndReturnScope } from "@/src/features/publicApi/server/apiAuth";

const GetUsersSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().lte(100).default(50),
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  await runMiddleware(req, res, cors);

  // CHECK AUTH
  const authCheck = await verifyAuthHeaderAndReturnScope(
    req.headers.authorization
  );
  if (!authCheck.validKey)
    return res.status(401).json({
      success: false,
      message: authCheck.error,
    });
  // END CHECK AUTH

  try {
    if (req.method === "GET") {
      if (authCheck.scope.accessLevel !== "all") {
        return res.status(401).json({
          success: false,
          message:
            "Access denied - need to use basic auth with secret key to GET scores",
        });
      }

      const obj = GetUsersSchema.parse(req.query); // uses query and not body

      const [users, totalItemsRes] = await Promise.all([
        prisma.$queryRaw`
          WITH model_usage AS (
            SELECT
              user_id,
              DATE_TRUNC('DAY',
                o.start_time) observation_day,
              o.model,
              SUM(o.prompt_tokens) prompt_tokens,
              SUM(o.completion_tokens) completion_tokens,
              SUM(o.total_tokens) total_tokens
            FROM
              traces t
            LEFT JOIN observations o ON o.trace_id = t.id
            WHERE o.start_time IS NOT NULL
            AND project_id = ${authCheck.scope.projectId}
            GROUP BY 1,2,3
            order by 1,2 desc,3
          ),
          daily_usage AS (
            SELECT
              user_id,
              observation_day,
              json_agg(json_build_object('model',
                  model,
                  'prompt_tokens',
                  prompt_tokens,
                  'completion_tokens',
                  completion_tokens,
                  'total_tokens',
                  total_tokens)) daily_usage_json
            FROM model_usage
            WHERE prompt_tokens > 0
            OR completion_tokens > 0
            OR total_tokens > 0
            group by 1,2
            order by 1,2 desc
          ),
          all_users AS (
            SELECT distinct user_id
            FROM traces
            WHERE project_id = ${authCheck.scope.projectId}
          )
          SELECT
            all_users.user_id,
            json_agg(json_build_object(
                'date',
                observation_day,
                'usage',
                daily_usage_json
            )) metrics
          FROM all_users
          LEFT JOIN daily_usage ON all_users.user_id = daily_usage.user_id
          group by 1
          ORDER BY 1
          LIMIT ${obj.limit} OFFSET ${(obj.page - 1) * obj.limit}
        `,
        prisma.$queryRaw<{ count: bigint }[]>`
          SELECT
            count(DISTINCT CASE WHEN user_id IS NULL THEN 'COUNT_NULL' ELSE user_id END)
          FROM
            traces
          WHERE project_id = ${authCheck.scope.projectId}
        `,
      ]);

      const totalItems =
        totalItemsRes[0] !== undefined ? Number(totalItemsRes[0].count) : 0;

      return res.status(200).json({
        data: users,
        meta: {
          page: obj.page,
          limit: obj.limit,
          totalItems,
          totalPages: Math.ceil(totalItems / obj.limit),
        },
      });
    } else {
      console.error(req.method, req.body);
      return res.status(405).json({ message: "Method not allowed" });
    }
  } catch (error: unknown) {
    console.error(error);
    const errorMessage =
      error instanceof Error ? error.message : "An unknown error occurred";
    res.status(400).json({
      success: false,
      message: "Invalid request data",
      error: errorMessage,
    });
  }
}
