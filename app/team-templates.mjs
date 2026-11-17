// Team templates: one click creates a set of role agents and a group.

export const TEAM_TEMPLATES = {
  "software-squad": {
    id: "software-squad",
    name: "软件小队",
    description: "产品经理 + 业务分析师 + 架构师 + 工程师 + 评审 + 测试；从需求到验证的梯队。",
    groupName: "软件小队",
    roles: ["product-manager", "business-analyst", "architect", "coder", "reviewer", "qa"],
  },
  "review-squad": {
    id: "review-squad",
    name: "方案评审小队",
    description: "架构师 + 评审 + 安全；评审方案可行性、风险和安全隐患。",
    groupName: "方案评审小队",
    roles: ["architect", "reviewer", "security"],
  },
  "research-squad": {
    id: "research-squad",
    name: "调研小队",
    description: "研究员 + 技术写作者；一个查证，一个把结论写成可读材料。",
    groupName: "调研小队",
    roles: ["researcher", "tech-writer"],
  },
};

export const TEAM_LIST = Object.values(TEAM_TEMPLATES);
export const TEAM_IDS = TEAM_LIST.map((t) => t.id);

export function getTeamTemplate(id) {
  return TEAM_TEMPLATES[id] ?? null;
}

export function shortRoleName(templateId) {
  const map = {
    "product-manager": "pm",
    "business-analyst": "ba",
    architect: "arch",
    coder: "coder",
    reviewer: "reviewer",
    qa: "qa",
    researcher: "researcher",
    "tech-writer": "writer",
    ops: "ops",
    security: "security",
    operations: "ops-biz",
    facilitator: "facilitator",
    generic: "agent",
  };
  return map[templateId] ?? templateId.replace(/[^a-z0-9-]/g, "-").slice(0, 20);
}

export function publicTeam(template) {
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    groupName: template.groupName,
    roles: template.roles,
  };
}
