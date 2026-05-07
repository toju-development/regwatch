/**
 * DTO for `POST /alerts/:id/comments`.
 * sdd/alert-collaboration/spec R "Comment CRUD Authorization".
 * Max depth = 1: parentId must point to a root comment (parentId === null).
 */
import { z } from 'zod';

export const createCommentSchema = z.object({
  body: z.string().min(1),
  parentId: z.string().optional(),
});

export type CreateCommentDto = z.infer<typeof createCommentSchema>;
