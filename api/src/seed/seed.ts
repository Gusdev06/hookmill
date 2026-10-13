// Seed: cria o workspace e o primeiro OWNER a partir do .env (SEED_*). Idempotente.
// Rode pela raiz: `npm run db:seed` (passa pelo guard-db: só banco localhost).
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../common/util/crypto';
import { normalizeEmail } from '../common/util/format';
import { shortCodeFromName } from '../workspaces/cliente';

async function main() {
  const email = normalizeEmail(required('SEED_OWNER_EMAIL'));
  const password = required('SEED_OWNER_PASSWORD');
  const workspaceName = process.env.SEED_WORKSPACE_NAME || 'Workspace';
  const cap = Number(process.env.DEFAULT_MONTHLY_SPEND_CAP_USD);
  if (password.length < 10) throw new Error('SEED_OWNER_PASSWORD precisa de 10+ caracteres');

  const prisma = new PrismaClient();
  try {
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      user = await prisma.user.create({
        data: { email, name: email.split('@')[0], passwordHash: await hashPassword(password) },
      });
      console.log(`[seed] usuário criado: ${email}`);
    } else {
      console.log(`[seed] usuário já existe: ${email} (senha mantida)`);
    }

    const owned = await prisma.membership.findFirst({
      where: { userId: user.id, role: 'OWNER', workspace: { name: workspaceName } },
      include: { workspace: true },
    });
    if (owned) {
      console.log(`[seed] workspace já existe: ${owned.workspace.name} (${owned.workspace.id})`);
      return;
    }
    const ws = await prisma.workspace.create({
      data: {
        name: workspaceName,
        // fase 2: o workspace do seed já opera (igual ao backfill da migração fase2_agencia): LIVE, não SETUP
        shortCode: shortCodeFromName(workspaceName),
        onboardingStep: 6,
        onboardingCompletedAt: new Date(),
        monthlySpendCapUsd: Number.isFinite(cap) && cap > 0 ? cap : null,
        memberships: { create: { userId: user.id, role: 'OWNER' } },
      },
    });
    console.log(`[seed] workspace criado: ${ws.name} (${ws.id}), OWNER ${email}`);
  } finally {
    await prisma.$disconnect();
  }
}

function required(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`${key} não definido no api/.env`);
  return v;
}

main().catch((e) => {
  console.error('[seed] erro:', e.message);
  process.exit(1);
});
