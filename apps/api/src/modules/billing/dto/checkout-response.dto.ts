/**
 * DTO returned by `POST /org/:orgId/billing/checkout`.
 *
 * sdd/billing-stripe POST-9 — Task 2.3.
 */
export class CheckoutResponseDto {
  url!: string;
}
