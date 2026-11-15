import { PLAN_GROUPS, PLAN_TABLE, planTotals } from '../../src/data/entitlement';
import { planGroupNameZh } from '../../src/i18n/plan';

const data = {
  totals: planTotals(),
  groups: PLAN_GROUPS.map((g) => ({
    name: planGroupNameZh(g.key),
    rows: g.rows.map((k) => {
      const r = PLAN_TABLE.find((x) => x.key === k);
      return { name: r?.name ?? k, free: r?.free ?? 'no', pro: r?.pro ?? 'no' };
    }),
  })),
};

process.stdout.write(JSON.stringify(data));
