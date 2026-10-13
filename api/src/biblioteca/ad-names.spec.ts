import { Prisma } from '@prisma/client';
import { computeAdName, isAdNameConflict } from './ad-names';

const p2002 = (target: unknown) => new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'x', meta: { target } });

describe('ad-names (banco mockado)', () => {
  it('P2002 no unique (workspace_id, ad_name) = conflito de nome; outro unique não', () => {
    expect(isAdNameConflict(p2002(['workspace_id', 'ad_name']))).toBe(true);
    expect(isAdNameConflict(p2002('creatives_workspace_id_ad_name_key'))).toBe(true);
    expect(isAdNameConflict(p2002(['final_render_id']))).toBe(false);
    expect(isAdNameConflict(new Error('x'))).toBe(false);
  });

  it('computeAdName: colisão contra os congelados do workspace, sem contar o próprio criativo', async () => {
    const findMany = jest.fn().mockResolvedValue([{ adName: 'MC_ITER_0105_CTRL_ORIG_1x1' }, { adName: 'MC_ITER_0105_CTRL_ORIG_1x1_2' }]);
    const db = {
      creative: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'c1', workspaceId: 'w1', origin: 'VARIATION', approvedAt: null, format: 'SQUARE_1_1', adName: null,
          workspace: { shortCode: 'MC' }, selectedScript: null, selectedFace: null,
          variationItem: { kind: 'NEW_HOOKS', index: -1, isControl: true },
        }),
        findMany,
      },
    };
    const name = await computeAdName(db as never, 'c1', { approvedAt: new Date('2026-01-05T10:00:00Z') });
    expect(name).toBe('MC_ITER_0105_CTRL_ORIG_1x1_3');
    expect(findMany.mock.calls[0][0].where).toMatchObject({ workspaceId: 'w1', id: { not: 'c1' }, adName: { startsWith: 'MC_ITER_0105_CTRL_ORIG_1x1' } });
  });
});
