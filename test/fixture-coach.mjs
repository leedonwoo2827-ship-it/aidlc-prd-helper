import { STEPS } from '../public/shared.js';
import { isDeferred } from '../public/workshop.js';
export function domainFor(text) {
  if (/테이블|메뉴|주문.*직원/.test(text)) return 'order';
  if (/회의실|공간.*예약/.test(text)) return 'booking';
  if (/재고|입출고|카페|창고/.test(text)) return 'inventory';
  if (/문의|고객|티켓|상담/.test(text)) return 'support';
  if (/회의|회의록/.test(text)) return 'meeting';
  return 'general';
}
const choices = {
  order: [
    [],
    ['손님은 메뉴를 주문하고, 직원은 주문을 확인해요', '직원이 테이블별 주문을 수기로 받아 누락이 생겨요'],
    ['메뉴 조회 → 수량 선택 → 주문 접수 → 직원 확인', '테이블 선택 → 주문 확인 → 준비 완료 표시'],
    ['메뉴 목록, 테이블별 주문, 주문 상태 변경', '주문 등록과 주방의 접수 확인까지만 만들어요'],
    ['가상 메뉴 10개와 테이블 5개, 결제 정보는 없어요', '로컬에서 가상 주문을 저장하고 외부 POS는 연결하지 않아요'],
    ['메뉴 조회와 주문 상태까지만, 결제·쿠폰·배달은 제외해요', '한 매장의 테이블 주문만 다루고 다중 매장은 제외해요'],
    ['테이블에서 메뉴 2개를 주문하면 직원 화면에서 주문이 보여요', '주문 수량이 0이거나 메뉴가 없으면 접수하지 않고 이유를 알려줘요']
  ],
  booking: [
    [],
    ['직원이 회의실 일정을 메신저로 물어봐야 해서 불편해요', '총무 담당자가 예약 중복을 수기로 확인하고 있어요'],
    ['회의실 선택 → 빈 시간 확인 → 예약 → 예약 확인', '내 예약 조회 → 예약 취소 → 해당 시간 다시 예약 가능'],
    ['회의실 목록, 시간대별 예약, 예약 취소', '빈 시간 조회와 중복 예약 방지부터 만들어요'],
    ['가상 회의실 3개와 예약 데이터만 사용해요', '외부 캘린더나 사내 계정 연동 없이 로컬 데이터로 시작해요'],
    ['한 사무실의 회의실 예약만, 반복 예약과 외부 연동은 제외해요', '조회·예약·취소까지 다루고 알림 발송은 미뤄요'],
    ['같은 회의실의 겹치는 시간은 예약할 수 없어야 해요', '예약을 취소하면 그 시간에 다시 예약할 수 있어야 해요']
  ],
  inventory: [
    [],
    ['작은 카페 점주가 엑셀 대신 쓰려고 해요', '창고 담당자가 입출고 누락을 줄이고 싶어요', '매장 직원이 남은 재고를 바로 확인하고 싶어요'],
    ['재료 선택 → 입출고 기록 → 남은 수량 확인', '재고 조회 → 부족한 재료 확인 → 발주 목록 작성', '입고 기록 → 이력 조회 → 잘못된 기록 수정'],
    ['재료 목록, 입출고 기록, 현재 재고 조회', '재고 검색, 부족 수량 표시, 변경 이력', '재료 등록, 수량 수정, 재고 목록 다운로드'],
    ['가상 재료 10개, 로컬 저장, 외부 연동 없음', '준비한 CSV로 시작하고 개인정보는 사용하지 않아요', '데이터는 아직 없고 워크숍용으로 만들 예정이에요'],
    ['한 매장의 입출고만 구현하고 POS·다중 매장은 제외해요', '재고 조회와 기록까지 만들고 배포는 다음으로 미뤄요', '로컬 시연까지 만들고 로그인·외부 연동은 제외해요'],
    ['10개에서 3개를 출고하면 7개가 되고 이력이 남아요', '재고보다 많이 출고하면 거절하고 기존 수량을 유지해요', '입고 후 새로고침해도 수량과 이력이 유지돼요']
  ],
  support: [
    [],
    ['CS 담당자가 흩어진 문의를 한곳에서 확인해요', '운영 담당자가 미처리 문의를 놓치지 않으려 해요', '소규모 팀이 스프레드시트를 대신해 쓰려고 해요'],
    ['문의 등록 → 담당자 확인 → 처리 상태 변경', '문의 검색 → 내용 확인 → 답변 기록', '미처리 문의 조회 → 우선순위 지정 → 완료 처리'],
    ['문의 목록, 상세 보기, 처리 상태 변경', '문의 등록, 검색, 답변 기록', '상태별 필터, 담당자 지정, 처리 이력'],
    ['개인정보 없는 가상 문의 10건으로 시작해요', '외부 채널 연동 없이 직접 입력해요', '익명화한 CSV를 사용하고 AI 답변 발송은 제외해요'],
    ['문의 조회와 상태 변경까지, 이메일 발송은 제외해요', '한 팀의 로컬 시연까지 만들고 실제 고객 연동은 미뤄요', '가상 문의로 배포·시연하고 실제 고객 데이터는 제외해요'],
    ['문의 상태를 완료로 바꾸면 미처리 목록에서 빠져요', '문의 검색 시 해당 내용만 표시되고 빈 결과도 안내해요', '답변을 저장하면 같은 문의에서 다시 확인할 수 있어요']
  ],
  meeting: [
    [],
    ['회의 진행자가 회의 후 할 일을 정리하려고 해요', '팀원이 자신의 후속 작업을 놓치지 않으려 해요', '프로젝트 담당자가 결정 사항을 추적하고 싶어요'],
    ['회의록 입력 → 결정 사항 정리 → 할 일 확인', '텍스트 업로드 → 요약 검토 → 담당자별 작업 내려받기', '회의 메모 입력 → 수정 → Markdown 저장'],
    ['회의록 입력, 결정 사항 정리, 할 일 추출', '요약 검토, 담당자 수정, Markdown 내려받기', '회의록 저장, 검색, 후속 작업 체크'],
    ['가상 회의록으로 시작하고 음성 녹음은 제외해요', '개인정보를 제거한 텍스트를 사용해요', '업로드 없이 텍스트 붙여넣기만 제공해요'],
    ['회의록 한 건 처리까지, 캘린더·Slack 연동은 제외해요', '로컬에서 요약과 검토까지 만들고 자동 공유는 미뤄요', '텍스트 입력과 Markdown 출력만 구현해요'],
    ['결정 사항과 할 일이 원문과 구분되어 표시돼요', '담당자가 없는 작업은 임의로 지정하지 않고 확인 필요로 남겨요', '수정한 결과가 내려받은 Markdown에 그대로 반영돼요']
  ],
  general: [
    [],
    ['실무 담당자 한 명이 반복 작업을 줄이려고 해요', '고객이 지금보다 쉽게 정보를 찾게 하고 싶어요', '사용자가 아직 명확하지 않아 함께 좁혀 보고 싶어요'],
    ['정보 입력 → 결과 확인 → 수정 또는 저장', '목록 조회 → 원하는 항목 선택 → 상태 변경', '자료 업로드 → 내용 검토 → 결과 내려받기'],
    ['입력, 결과 확인, 저장의 세 가지에 집중할게요', '조회와 수정부터 만들고 나머지는 나중에 해요', '가장 중요한 사용 흐름 하나만 동작하게 할게요'],
    ['가상 데이터로 시작하고 외부 연동은 제외해요', '준비한 파일을 사용하고 개인정보는 제거할게요', '데이터와 기술 제약은 아직 확인이 필요해요'],
    ['핵심 흐름 하나를 로컬에서 시연하고 배포는 미뤄요', '준비된 환경에 배포하고 운영 자동화는 제외해요', '요구사항과 설계까지 정리하고 구현은 다음에 진행해요'],
    ['입력한 내용이 저장되고 다시 조회되어야 해요', '잘못된 입력을 안내하고 기존 데이터는 유지해야 해요', '핵심 흐름을 처음부터 끝까지 시연할 수 있어야 해요']
  ]
};
export function demoSuggestions(answers, stepIndex) {
  return choices[domainFor(answers.idea?.raw || '')][stepIndex] || [];
}
export async function demoCoach({ session, text, step }) {
  const uncertain = /모르|미정|확인.*필요|아직.*없/.test(text);
  if (/^(안녕|ㅎ+|테스트|test|hi|네|예|아니요)[.!? ]*$/i.test(text)) {
    return { accepted: false, summary: '', uncertain: true, reflection: '이 답변만으로는 범위를 정하기 어려워요.', question: STEPS[step].prompt, suggestions: demoSuggestions(session.answers, step) };
  }
  const answers = { ...session.answers, [STEPS[step].id]: { raw: text, value: text, uncertain } };
  const compact = text.length > 90 ? `${text.slice(0, 90)}…` : text;
  const reflections = [
    `“${compact}”라는 아이디어에서 시작할게요. 먼저 이 제품이 가장 필요한 사람과 지금 겪는 문제를 좁혀 봐요.`,
    `말씀하신 사용자와 현재의 불편함을 기록했어요. 그 사용자가 제품에서 끝낼 일 하나를 정하면 기능 범위가 더 선명해져요.`,
    `이 흐름을 이번 제품의 중심으로 잡을게요. 각 단계가 동작하는 데 꼭 필요한 기능만 골라 봐요.`,
    `필수 기능을 기록했어요. 실제로 쓸 수 있는 데이터와 연동 조건을 확인하면 이번 워크숍의 범위를 정할 수 있어요.`,
    '데이터와 제약을 기록했어요. 로컬에서 동작하는 MVP에 담을 범위와 다음으로 미룰 기능을 함께 정해 봐요.',
    `이번에 만들 범위와 미룰 항목을 기록했어요. 마지막으로 “완성됐다”를 판단할 구체적인 시연 기준을 정해요.`,
    `일곱 가지 답변이 모였어요. 오른쪽 PRD에서 실제 의도와 맞는지 확인해 주세요. 수정할 답변은 위의 완료한 단계를 눌러 바꿀 수 있어요.`
  ];
  const deferred = isDeferred(text);
  return {
    accepted: true, summary: deferred ? 'AI-DLC를 진행하면서 구체화할 예정.' : text, uncertain: uncertain || deferred, deferred,
    reflection: deferred ? `${STEPS[step].label}은 AI-DLC를 진행하면서 구체화할 항목으로 남겨둘게요. 정해지지 않은 내용을 대신 채우지 않고 다음 주제로 넘어갈게요.` : reflections[step],
    question: STEPS[step + 1]?.prompt || 'PRD의 범위와 완료 기준을 검토해 주세요.',
    suggestions: demoSuggestions(answers, step + 1)
  };
}
export function demoDocument(answers) {
  const grounded = (id, n) => answers[id] && !answers[id].uncertain ? [{ text: answers[id].value, sources: [n] }] : [];
  return {
    title: '워크숍 로컬 MVP · PRD',
    functionalRequirements: grounded('features', 4),
    nonFunctionalRequirements: [],
    acceptanceCriteria: grounded('acceptance', 7),
    outOfScope: [],
    openQuestions: STEPS.flatMap((s, i) => answers[s.id]?.uncertain ? [{ text: `${s.label}은 AI-DLC 진행 중 구체화한다.`, sources: [i + 1] }] : [])
  };
}

export async function fixtureCoach(payload) {
  const result = await demoCoach(payload);
  if (result.accepted && payload.step === 6) {
    const answers = { ...payload.session.answers, acceptance: { raw: payload.text, value: result.summary, uncertain: result.uncertain, deferred: result.deferred } };
    result.document = demoDocument(answers);
  }
  return result;
}
