import { enforceWorkshopContract } from './workshop.js';
export const STEPS = [
  { id: 'idea', label: '제품 아이디어', short: '아이디어', prompt: '어떤 불편함을 해결하는 제품을 만들고 싶으세요?', hint: '누가 어떤 일로 불편한지, 떠오르는 대로 적어 주세요. 아직 이름이 없어도 괜찮아요.' },
  { id: 'audience', label: '사용자와 문제', short: '사용자', prompt: '가장 먼저 이 제품을 쓸 사람은 누구이고, 지금은 그 일을 어떻게 하나요?', hint: '예: 작은 카페의 점주. 엑셀로 재고를 기록하다 보니 누락이 생겨요.' },
  { id: 'scenario', label: '핵심 사용 흐름', short: '사용 흐름', prompt: '그 사람이 제품을 열고, 어떤 일을 마칠 수 있으면 좋을까요?', hint: '시작부터 결과까지 한 가지 흐름으로 설명해 주세요.' },
  { id: 'features', label: '꼭 필요한 기능', short: '핵심 기능', prompt: '이 흐름을 만들기 위해 반드시 필요한 기능을 2~3개만 골라 주세요.', hint: '이번 워크숍에서 가장 먼저 보여 주고 싶은 기능에 집중해요.' },
  { id: 'data', label: '데이터와 제약', short: '데이터', prompt: '어떤 데이터를 사용할 수 있고, 꼭 지켜야 할 조건이 있나요?', hint: '예시 데이터, 실제 연동 여부, 개인정보, 실행 환경 등을 알려 주세요.' },
  { id: 'scope', label: 'MVP 범위', short: '범위', prompt: '이번 로컬 MVP에서 완성할 흐름과, 다음으로 미룰 기능은 무엇인가요?', hint: '공통 제외 항목은 이미 반영돼요. 이 제품에서 추가로 제외할 기능을 적어 주세요.' },
  { id: 'acceptance', label: '수용 기준', short: '수용 기준', prompt: '어떤 결과를 확인하면 핵심 요구사항이 충족됐다고 볼 수 있을까요?', hint: '정상 입력의 결과와, 잘못된 입력을 받았을 때의 동작을 적어 주세요. 미정으로 남겨도 괜찮아요.' }
];
export const EXAMPLES = [
  { id: 'order', industry: '외식', label: '테이블오더 서비스', icon: 'menu', text: '손님이 메뉴를 보고 테이블별로 주문하면, 직원이 주문을 확인하고 상태를 바꾸는 서비스를 만들고 싶어요. 결제는 제외해요.' },
  { id: 'inventory', industry: '유통', label: '재고 관리 도우미', icon: 'box', text: '작은 카페에서 입출고를 기록하고 남은 재고를 확인하는 앱을 만들고 싶어요.' },
  { id: 'booking', industry: '업무', label: '회의실 예약 시스템', icon: 'calendar', text: '직원이 회의실의 빈 시간을 확인하고 예약하거나 취소할 수 있는 시스템을 만들고 싶어요. 외부 캘린더 연동은 제외해요.' },
  { id: 'education', industry: '교육', label: '과제 제출 관리', icon: 'book', text: '선생님이 과제를 등록하고 학생별 제출 상태를 확인하는 도구를 만들고 싶어요. 가상의 학생과 과제 데이터로 시작해요.' },
  { id: 'factory', industry: '제조', label: '설비 점검 기록', icon: 'check', text: '현장 담당자가 설비 점검 항목을 체크하고 이상 내용을 기록하는 도구를 만들고 싶어요. 센서 연동 없이 가상 설비 데이터를 사용해요.' },
  { id: 'clinic', industry: '의료', label: '예약 접수 현황', icon: 'calendar', text: '접수 담당자가 오늘의 예약을 보고 방문·대기·완료 상태를 바꾸는 현황판을 만들고 싶어요. 가상 예약만 사용하고 진료 정보는 다루지 않아요.' },
  { id: 'property', industry: '부동산', label: '수리 요청 관리', icon: 'home', text: '건물 관리자가 세대별 수리 요청을 접수하고 처리 상태를 기록하는 도구를 만들고 싶어요. 가상의 세대와 요청을 사용해요.' }
];

export const EXAMPLE_ANSWERS = [
  EXAMPLES.find(e => e.id === 'inventory').text,
  '카페 점주 한 명이 사용해요. 지금은 엑셀로 적어서 바쁜 시간에 기록이 빠지고, 남은 재료를 바로 알기 어려워요.',
  '점주가 재료를 선택하고 입고 또는 사용 수량을 입력하면, 현재 남은 수량과 변경 이력을 확인해요.',
  '재료 목록 조회, 입출고 수량 기록, 현재 재고와 이력 확인이 필요해요.',
  '가상 재료 10개로 시작해요. 고객 개인정보는 사용하지 않고, 외부 POS 연동 없이 로컬에서 실행해요.',
  '이번에는 한 명이 쓰는 로컬 프로토타입까지 만들어요. 로그인, 여러 매장, POS 연동, 클라우드 배포는 제외해요.',
  '우유 10개에서 3개를 사용하면 7개로 표시되고, 사용 기록이 남아야 해요. 재고보다 많이 출고하려 하면 거절하고 수량을 유지해야 해요.'
];

export function sectionsFromAnswers(answers) {
  return [
    { title: '제품 개요', value: answers.idea?.value },
    { title: '사용자와 해결할 문제', value: answers.audience?.value },
    { title: '핵심 사용 흐름', value: answers.scenario?.value },
    { title: '필수 기능', value: answers.features?.value },
    { title: '데이터와 제약', value: answers.data?.value },
    { title: 'MVP 범위와 제품별 제외 항목', value: answers.scope?.value },
    { title: '수용 기준', value: answers.acceptance?.value }
  ];
}
export function draftMarkdown(answers, { reviewed = false, mode = 'bedrock', createdAt = new Date().toISOString(), productDoc = null } = {}) {
  const heading = productDoc?.title || '워크숍 로컬 MVP · PRD';
  const safe = value => String(value ?? '확인 필요').replace(/\r/g, '');
  const lines = [
    `# ${safe(heading)}`, '', '> AI-DLC 워크숍 PRD', '',
    `- 문서 상태: ${reviewed ? '사용자 검토 완료' : '검토 전 초안'}`,
    `- 작성 방식: ${mode === 'bedrock' ? 'Bedrock 대화 기반' : '설명용 문서 예시'}`,
    `- 작성 시각: ${createdAt}`, '',
    '이 문서는 AI-DLC의 시작 입력입니다. 미정 항목은 실제 워크플로우에서 질문과 사용자 확인을 거쳐 구체화합니다.', ''
  ];
  sectionsFromAnswers(answers).forEach((section, i) => lines.push(`## ${i + 1}. ${section.title}`, '',
    answers[STEPS[i].id]?.deferred ? 'AI-DLC를 진행하면서 구체화할 예정. [보류]' : safe(section.value),
    answers[STEPS[i].id] ? `\n근거: [Q${i + 1}]${answers[STEPS[i].id].uncertain ? ' · 미확정' : ''}` : '', ''));
  const writeClaims = (title, values, prefix) => {
    lines.push(`## ${title}`, '');
    if (!values?.length) lines.push('AI-DLC 요구사항 분석에서 구체화할 예정.', '');
    else values.forEach((item, i) => lines.push(`- ${prefix ? `**${prefix}${i + 1}:** ` : ''}${item.text} ${item.sources.map(n => `[Q${n}]`).join(' ')}`, ''));
  };
  writeClaims('8. 기능 요구사항', productDoc?.functionalRequirements, 'FR');
  writeClaims('9. 비기능 요구사항', productDoc?.nonFunctionalRequirements, 'NFR');
  writeClaims('10. 검증할 수용 기준', productDoc?.acceptanceCriteria, 'AC');
  if (productDoc?.outOfScope?.length) writeClaims('11. 제품별 추가 제외 기능', productDoc.outOfScope, '');
  lines.push('## AI-DLC에서 이어서 구체화할 사항', '');
  const missing = STEPS.filter(step => !answers[step.id] || answers[step.id].uncertain);
  lines.push(...missing.map(step => `- ${step.label}: ${answers[step.id]?.deferred ? 'AI-DLC 진행 중 구체화 예정' : '확인 필요'} [Q${STEPS.indexOf(step) + 1}]`));
  productDoc?.openQuestions?.forEach(item => lines.push(`- ${item.text} ${item.sources.map(n => `[Q${n}]`).join(' ')}`));
  lines.push('- 명시적으로 정하지 않은 기술 스택과 상세 설계는 AI-DLC에서 단일 유닛 안의 설계로 구체화한다.',
    '- 미확정 요구사항과 가정은 사용자 확인 없이 확정 사실로 전환하지 않는다.', '',
    '## AI-DLC 인계', '',
    '프로젝트 루트에 `prd.md`를 저장하고 AI-DLC 시작 요청에서 이 파일을 참조한다. 질문·설계·승인 절차는 AI-DLC에서 이어간다.', '',
    '/aidlc Read ./prd.md as the starting requirements. Build a locally runnable MVP in a single Unit of Work. Confirm open questions and preserve all workshop exclusions.',
    '', 'Codex의 AI-DLC 호출은 `$aidlc`를 사용한다.', '',
    '## 부록. 답변 출처', '');
  STEPS.filter(step => answers[step.id]).forEach(step => lines.push(`### Q${STEPS.indexOf(step) + 1}. ${step.label}`, '', ...safe(answers[step.id].raw).split('\n').map(line => `> ${line}`), ''));
  return enforceWorkshopContract(lines.join('\n'));
}
