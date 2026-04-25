import { PrismaClient, Role } from '../src/generated/client/index.js';
import { DEV_INVITATION_TOKEN } from '../src/tokens.js';

if (process.env.NODE_ENV === 'production') {
  throw new Error('[seed] refusing to run with NODE_ENV=production (production guard)');
}

const ORG_SLUG = 'regwatch-dev';
const ORG_NAME = 'Regwatch Dev';
const USER_EMAIL = 'dev@regwatch.local';
const USER_NAME = 'Dev Owner';
const INVITE_EMAIL = 'pending@regwatch.local';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const prisma = new PrismaClient();

async function main() {
  const org = await prisma.organization.upsert({
    where: { slug: ORG_SLUG },
    create: { slug: ORG_SLUG, name: ORG_NAME },
    update: {},
  });

  const user = await prisma.user.upsert({
    where: { email: USER_EMAIL },
    create: {
      email: USER_EMAIL,
      name: USER_NAME,
      emailVerified: new Date(),
    },
    update: {},
  });

  await prisma.membership.upsert({
    where: {
      userId_organizationId: { userId: user.id, organizationId: org.id },
    },
    create: { userId: user.id, organizationId: org.id, role: Role.OWNER },
    update: {},
  });

  await prisma.invitation.upsert({
    where: { token: DEV_INVITATION_TOKEN },
    create: {
      organizationId: org.id,
      email: INVITE_EMAIL,
      role: Role.ANALYST,
      token: DEV_INVITATION_TOKEN,
      expiresAt: new Date(Date.now() + SEVEN_DAYS_MS),
    },
    update: {},
  });

  console.log(
    `Seeded: org=${ORG_SLUG}, user=${USER_EMAIL}, membership=OWNER, invitation=${DEV_INVITATION_TOKEN}`,
  );
}

main()
  .catch((err) => {
    console.error('[seed] failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
