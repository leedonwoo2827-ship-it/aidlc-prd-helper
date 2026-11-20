# 고객 워크숍 계정 운영

`config/deployment.json`으로 고객 스택을 지정한다. 도구는 AWS 계정 일치 검사 후
해당 스택의 Cognito, DynamoDB, Scheduler 역할을 조회한다.
기존 환경의 계정·주소는 기본값으로 제공하지 않는다.

## 발급

아래 날짜와 계정 이름은 고객 일정으로 바꾼다. 명령을 실행하면 실제 계정이 생성된다.

```sh
node scripts/workshop-account.mjs create \
  --username workshop-YYYYMMDD \
  --start YYYY-MM-DDT09:00:00+09:00 \
  --end YYYY-MM-DDT18:00:00+09:00
```

시작을 생략하면 즉시 이용할 수 있다. 종료는 필수이며 최대 72시간이다.
새 무작위 비밀번호를 생성하여 `.local/accounts/<계정>.json`에 `0600` 권한으로 저장한다.
운영자가 의도적으로 비밀번호를 재사용할 때만 `--password-from PRIVATE_ACCOUNT_JSON`을
사용한다. 명령행에 비밀번호를 직접 입력하지 않는다. 같은 계정 이름은 덮어쓰지 않는다.
운영자에게는 해당 풀의 사용자 관리, 테이블 항목 관리, Scheduler 생성/삭제와 대상 역할의
`iam:PassRole` 권한이 필요하다. 런타임 역할 권한과 배포/운영자 권한을 구분한다.

## 종료

```sh
node scripts/workshop-account.mjs close --username workshop-YYYYMMDD
```

API 이용을 먼저 막고 Cognito 계정을 삭제한다. 예정된 종료도 모든 인증 API가 즉시 검사하므로,
종료 후에는 아직 만료되지 않은 JWT도 사용할 수 없다. 진행 중 응답은 저장 전에 기간을
다시 확인한다. Scheduler의 계정 삭제 및 DynamoDB TTL 물리 삭제는 비동기이다.

## 분리와 제한

같은 계정으로 로그인해도 Cognito `sub`, 로그인 토큰의 `origin_jti`(또는 `jti`),
대화별 접근 키가 모두 맞아야 대화에 접근한다. 로그아웃과 새 탭은 기존 대화 복원이 아니다.
토큰과 접근 키는 탭 메모리에만 저장한다. 대화별 잠금·revision·request ID로 동시 쓰기와
중복 반영을 차단한다.

현재 기본값은 Lambda 동시 실행 30, 계정당 모델 호출 한도 2,000, 대화당 전송 시도 40이다.
이는 제품의 제한 설정이며 고객 환경의 처리량 보증이 아니다. 실패 시도도 한도에 포함될 수 있다.
행사 규모에 맞는 별도 부하 검사와 고객 계정의 할당량 확인이 필요하다.

`scripts/verify-deployed.mjs`는 임시 만료 검증 계정을 생성한다.
검증이 중단되어 남은 계정은 이 도구의 `close`로 폐기하거나 예약 종료를 확인한다.
계정 JSON, 실제 생성 PRD, 모델 출력과 운영 로그는 다시 전달할 ZIP에 넣지 않는다.
