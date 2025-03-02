import { z } from "zod";

import {
  createTRPCRouter,
  protectedProcedure,
  protectedProjectProcedure,
} from "@/src/server/api/trpc";
import { throwIfNoAccess } from "@/src/features/rbac/utils/checkAccess";

const ScoreFilterOptions = z.object({
  traceId: z.array(z.string()).nullable(),
  id: z.array(z.string()).nullable(),
  projectId: z.string(), // Required for protectedProjectProcedure
  userId: z.string().nullable(),
});

export const scoresRouter = createTRPCRouter({
  all: protectedProjectProcedure
    .input(ScoreFilterOptions)
    .query(async ({ input, ctx }) =>
      ctx.prisma.score.findMany({
        orderBy: {
          timestamp: "desc",
        },
        where: {
          trace: {
            projectId: input.projectId,
            ...(input.userId ? { userId: input.userId } : undefined),
          },
          ...(input.traceId
            ? {
                traceId: { in: input.traceId },
              }
            : undefined),
          ...(input.id
            ? {
                id: {
                  in: input.id,
                },
              }
            : undefined),
        },
        take: 100, // TODO: pagination
      })
    ),
  availableFilterOptions: protectedProjectProcedure
    .input(ScoreFilterOptions)
    .query(async ({ input, ctx }) => {
      const filter = {
        trace: {
          projectId: input.projectId,
          ...(input.userId ? { userId: input.userId } : undefined),
        },
        ...(input.id
          ? {
              id: {
                in: input.id,
              },
            }
          : undefined),
        ...(input.traceId
          ? {
              traceId: {
                in: input.traceId,
              },
            }
          : undefined),
      };

      const [ids, traceIds] = await Promise.all([
        ctx.prisma.score.groupBy({
          where: filter,
          by: ["id"],
          _count: {
            _all: true,
          },
        }),
        ctx.prisma.score.groupBy({
          where: filter,
          by: ["traceId"],
          _count: {
            _all: true,
          },
        }),
      ]);

      return [
        {
          key: "id",
          occurrences: ids.map((i) => {
            return { key: i.id, count: i._count };
          }),
        },
        {
          key: "traceId",
          occurrences: traceIds.map((i) => {
            return { key: i.traceId, count: i._count };
          }),
        },
      ];
    }),
  byId: protectedProcedure.input(z.string()).query(({ input, ctx }) =>
    ctx.prisma.score.findFirstOrThrow({
      where: {
        id: input,
        trace: {
          project: {
            members: {
              some: {
                userId: ctx.session.user.id,
              },
            },
          },
        },
      },
    })
  ),
  create: protectedProcedure
    .input(
      z.object({
        traceId: z.string(),
        value: z.number(),
        name: z.string(),
        comment: z.string().optional(),
        observationId: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const trace = await ctx.prisma.trace.findFirstOrThrow({
        where: {
          id: input.traceId,
          project: {
            members: {
              some: {
                userId: ctx.session.user.id,
              },
            },
          },
        },
      });
      throwIfNoAccess({
        session: ctx.session,
        projectId: trace.projectId,
        scope: "scores:CUD",
      });

      return ctx.prisma.score.create({
        data: {
          trace: {
            connect: {
              id: trace.id,
            },
          },
          ...(input.observationId
            ? {
                observation: {
                  connect: {
                    id: input.observationId,
                  },
                },
              }
            : undefined),
          value: input.value,
          name: input.name,
          comment: input.comment,
        },
      });
    }),
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        value: z.number(),
        comment: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const score = await ctx.prisma.score.findFirstOrThrow({
        where: {
          id: input.id,
          trace: {
            project: {
              members: {
                some: {
                  userId: ctx.session.user.id,
                },
              },
            },
          },
        },
        include: {
          trace: {
            select: {
              projectId: true,
            },
          },
        },
      });
      throwIfNoAccess({
        session: ctx.session,
        projectId: score.trace.projectId,
        scope: "scores:CUD",
      });

      return ctx.prisma.score.update({
        where: {
          id: score.id,
        },
        data: {
          value: input.value,
          comment: input.comment,
        },
      });
    }),
  delete: protectedProcedure
    .input(z.string())
    .mutation(async ({ input, ctx }) => {
      const score = await ctx.prisma.score.findFirstOrThrow({
        where: {
          id: input,
          trace: {
            project: {
              members: {
                some: {
                  userId: ctx.session.user.id,
                },
              },
            },
          },
        },
        include: {
          trace: {
            select: {
              projectId: true,
            },
          },
        },
      });
      throwIfNoAccess({
        session: ctx.session,
        projectId: score.trace.projectId,
        scope: "scores:CUD",
      });

      return ctx.prisma.score.delete({
        where: {
          id: score.id,
        },
      });
    }),
});
