#!/usr/bin/env bash
# =============================================================================
# deploy-agentcore.sh
#
# Amazon Bedrock AgentCore Runtime のデプロイスクリプト。
# 以下の手順を自動化する：
#   1. Terraform outputs から ECR URL・AgentCore ロール ARN を取得
#   2. ARM64 コンテナイメージをビルド
#   3. ECR にプッシュ
#   4. AgentCore Runtime を作成（または更新）
#   5. 取得した ARN を terraform.tfvars に書き込み
#   6. terraform apply で runner Lambda の環境変数を更新
#
# 使い方:
#   ./scripts/deploy-agentcore.sh
#   AWS_PROFILE=<profile> ./scripts/deploy-agentcore.sh
#
# 前提条件:
#   - aws sso login 済み・AWS_PROFILE が設定されていること
#   - terraform apply（Phase 1: agentcore_runtime_arn = "" のまま）が完了していること
#   - Docker が起動していること（ARM64 ビルドに docker buildx または QEMU が必要）
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
INFRA_DIR="${PROJECT_ROOT}/infrastructure"
AGENT_DIR="${PROJECT_ROOT}/backend/agent"

# AWS 設定
AWS_PROFILE="${AWS_PROFILE:-}"
PROFILE_FLAG=""
if [[ -n "${AWS_PROFILE}" ]]; then
  PROFILE_FLAG="--profile ${AWS_PROFILE}"
fi

PROJECT_NAME="${PROJECT_NAME:-video-edit}"
AGENTCORE_REGION="${AGENTCORE_REGION:-us-east-1}"
RUNTIME_NAME="${PROJECT_NAME}-agent"

# =============================================================================
# ユーティリティ関数
# =============================================================================
log()  { echo "[$(date '+%H:%M:%S')] $*"; }
err()  { echo "[$(date '+%H:%M:%S')] ERROR: $*" >&2; exit 1; }

tf_output() {
  terraform -chdir="${INFRA_DIR}" output -raw "$1" 2>/dev/null || echo ""
}

# =============================================================================
# Step 1: Terraform outputs を取得
# =============================================================================
log "Step 1: Terraform outputs を取得中..."
# AgentCore Runtime は us-east-1 で動作するため us-east-1 の ECR を使用する
# （ap-northeast-1 の ECR を使うと IAM 権限エラーでコンテナが起動しない）
ECR_URL="$(tf_output ecr_repository_url_useast1)"
AGENTCORE_ROLE_ARN="$(tf_output agentcore_runtime_role_arn)"

[[ -z "${ECR_URL}" ]]              && err "ecr_repository_url_useast1 が取得できません。terraform apply を先に実行してください。"
[[ -z "${AGENTCORE_ROLE_ARN}" ]]   && err "agentcore_runtime_role_arn が取得できません。terraform apply を先に実行してください。"

log "  ECR URL (us-east-1): ${ECR_URL}"
log "  AgentCore Role ARN : ${AGENTCORE_ROLE_ARN}"

# ECR レジストリ（URL から <account>.dkr.ecr.<region>.amazonaws.com を抽出）
ECR_REGISTRY="${ECR_URL%%/*}"

# =============================================================================
# Step 2: ECR ログイン
# =============================================================================
log "Step 2: ECR ログイン（${ECR_REGISTRY}）..."
ECR_REGION="${ECR_URL#*.dkr.ecr.}"
ECR_REGION="${ECR_REGION%%.amazonaws.com*}"
aws ecr get-login-password --region "${ECR_REGION}" ${PROFILE_FLAG} \
  | docker login --username AWS --password-stdin "${ECR_REGISTRY}"

# =============================================================================
# Step 3: ARM64 イメージをビルド
# =============================================================================
log "Step 3: ARM64 イメージをビルド中..."
# Windows プロキシが干渉する場合は --build-arg でクリア
docker build \
  --platform linux/arm64 \
  --build-arg http_proxy="" \
  --build-arg https_proxy="" \
  --build-arg HTTP_PROXY="" \
  --build-arg HTTPS_PROXY="" \
  -t "${PROJECT_NAME}-agent:latest" \
  "${AGENT_DIR}"

# =============================================================================
# Step 4: ECR にプッシュ
# =============================================================================
log "Step 4: ECR にプッシュ中..."
docker tag "${PROJECT_NAME}-agent:latest" "${ECR_URL}:latest"
docker push "${ECR_URL}:latest"
log "  プッシュ完了: ${ECR_URL}:latest"

# =============================================================================
# Step 5: AgentCore Runtime を作成 or 更新
# =============================================================================
log "Step 5: AgentCore Runtime を作成/更新中..."

ARTIFACT_JSON=$(python -c "import json,sys; print(json.dumps({'containerConfiguration': {'containerUri': sys.argv[1]}}))" "${ECR_URL}:latest")

# terraform.tfvars から既存の Runtime ARN を読み取る（あれば update、なければ create）
EXISTING_ARN=$(grep -E '^agentcore_runtime_arn' "${INFRA_DIR}/terraform.tfvars" 2>/dev/null \
  | sed 's/.*=\s*"\(.*\)"/\1/' | tr -d '[:space:]' || echo "")

if [[ -n "${EXISTING_ARN}" && "${EXISTING_ARN}" != '""' ]]; then
  log "  更新（既存 ARN を使用）: ${EXISTING_ARN}"
  RUNTIME_ID="${EXISTING_ARN##*/}"
  RUNTIME_ID="${RUNTIME_ID%%:*}"
  aws bedrock-agentcore-control update-agent-runtime \
    --region "${AGENTCORE_REGION}" \
    ${PROFILE_FLAG} \
    --agent-runtime-id "${RUNTIME_ID}" \
    --agent-runtime-artifact "${ARTIFACT_JSON}" \
    --output json > /dev/null
  RUNTIME_ARN="${EXISTING_ARN}"
else
  # 新規作成: agentRuntimeName はアルファベット・数字・アンダースコアのみ許可（ハイフン不可）
  SAFE_RUNTIME_NAME="${RUNTIME_NAME//-/_}"
  log "  新規作成: ${SAFE_RUNTIME_NAME}"
  RESPONSE=$(
    aws bedrock-agentcore-control create-agent-runtime \
      --region "${AGENTCORE_REGION}" \
      ${PROFILE_FLAG} \
      --agent-runtime-name "${SAFE_RUNTIME_NAME}" \
      --agent-runtime-artifact "${ARTIFACT_JSON}" \
      --role-arn "${AGENTCORE_ROLE_ARN}" \
      --network-configuration '{"networkMode": "PUBLIC"}' \
      --lifecycle-configuration '{"idleRuntimeSessionTimeout": 900, "maxLifetime": 28800}' \
      --output json
  )
  RUNTIME_ARN=$(echo "${RESPONSE}" | python -c "import json,sys; print(json.load(sys.stdin).get('agentRuntimeArn',''))")
fi

[[ -z "${RUNTIME_ARN}" || "${RUNTIME_ARN}" == "null" ]] \
  && err "AgentCore Runtime ARN が取得できませんでした。"

log "  Runtime ARN: ${RUNTIME_ARN}"

# =============================================================================
# Step 6: terraform.tfvars に ARN を書き込み
# =============================================================================
log "Step 6: terraform.tfvars を更新中..."
TFVARS="${INFRA_DIR}/terraform.tfvars"

if [[ -f "${TFVARS}" ]]; then
  # 既存の agentcore_runtime_arn 行を置換、なければ追記
  if grep -q "^agentcore_runtime_arn" "${TFVARS}"; then
    # macOS と Linux 両対応の sed
    sed -i.bak "s|^agentcore_runtime_arn.*|agentcore_runtime_arn = \"${RUNTIME_ARN}\"|" "${TFVARS}"
    rm -f "${TFVARS}.bak"
  else
    echo "agentcore_runtime_arn = \"${RUNTIME_ARN}\"" >> "${TFVARS}"
  fi
else
  echo "agentcore_runtime_arn = \"${RUNTIME_ARN}\"" > "${TFVARS}"
fi
log "  terraform.tfvars を更新しました"

# =============================================================================
# Step 7: terraform apply（runner Lambda の env var を更新）
# =============================================================================
log "Step 7: terraform apply（Phase 2: ARN を注入）..."
pushd "${INFRA_DIR}" > /dev/null
terraform apply -auto-approve
popd > /dev/null

log "======================================================"
log "デプロイ完了！"
log "AgentCore Runtime ARN: ${RUNTIME_ARN}"
log ""
log "次のステップ:"
log "  - フロントエンドの変更がある場合: ./scripts/deploy-frontend.sh"
log "  - Lambda の変更がある場合:        aws lambda update-function-code ..."
log "======================================================"
