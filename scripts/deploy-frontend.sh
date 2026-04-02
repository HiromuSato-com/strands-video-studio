#!/usr/bin/env bash
# deploy-frontend.sh — フロントエンドのビルド・デプロイ・git push を一括実行
#
# 使い方:
#   ./scripts/deploy-frontend.sh
#   AWS_PROFILE=<profile> ./scripts/deploy-frontend.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
FRONTEND_DIR="$ROOT_DIR/frontend"
INFRA_DIR="$ROOT_DIR/infrastructure"

AWS_PROFILE="${AWS_PROFILE:-AWSAdministratorAccess-595351378921}"

# ── 色付きログ ────────────────────────────────────────────
log()  { echo "$(date '+%H:%M:%S') [INFO]  $*"; }
ok()   { echo "$(date '+%H:%M:%S') [OK]    $*"; }
err()  { echo "$(date '+%H:%M:%S') [ERROR] $*" >&2; exit 1; }

# ── 1. 接続先を取得（terraform output → AWS CLI フォールバック） ──
log "デプロイ先を取得中..."
cd "$INFRA_DIR"

# frontend_bucket: terraform output が使えれば使う、なければ AWS CLI で取得
if terraform output -raw frontend_bucket >/dev/null 2>&1; then
  FRONTEND_BUCKET=$(terraform output -raw frontend_bucket)
else
  ACCOUNT_ID=$(aws sts get-caller-identity --profile "$AWS_PROFILE" --query Account --output text)
  PROJECT_NAME=$(terraform output 2>/dev/null | grep s3_bucket | sed 's/.*= "\(.*\)-assets-.*/\1/' || echo "video-edit")
  FRONTEND_BUCKET="${PROJECT_NAME}-frontend-${ACCOUNT_ID}"
fi

# cloudfront_distribution_id: terraform output → AWS CLI フォールバック
if terraform output -raw cloudfront_distribution_id >/dev/null 2>&1; then
  CF_DIST_ID=$(terraform output -raw cloudfront_distribution_id)
else
  CF_DIST_ID=$(aws cloudfront list-distributions \
    --profile "$AWS_PROFILE" \
    --query "DistributionList.Items[?Origins.Items[0].DomainName | contains(@, '${FRONTEND_BUCKET}')].Id" \
    --output text)
fi

ok "bucket=${FRONTEND_BUCKET}  cf=${CF_DIST_ID}"

# ── 2. VITE_API_URL を terraform output から自動設定 ─────
log "VITE_API_URL を取得中..."
cd "$INFRA_DIR"
VITE_API_URL=$(terraform output -raw vite_api_url 2>/dev/null || echo "")
if [ -z "$VITE_API_URL" ]; then
  err "terraform output vite_api_url が取得できません。terraform apply 済みか確認してください。"
fi
ok "VITE_API_URL=${VITE_API_URL}"

# frontend/.env を更新（VITE_API_URL の行だけ差し替え、他の変数は保持）
ENV_FILE="$FRONTEND_DIR/.env"
if [ -f "$ENV_FILE" ] && grep -q "^VITE_API_URL=" "$ENV_FILE"; then
  # 既存の行を置換
  sed -i "s|^VITE_API_URL=.*|VITE_API_URL=${VITE_API_URL}|" "$ENV_FILE"
else
  # 新規追加
  echo "VITE_API_URL=${VITE_API_URL}" >> "$ENV_FILE"
fi
ok "frontend/.env を更新しました"

# ── 3. フロントエンドビルド ───────────────────────────────
log "npm run build..."
cd "$FRONTEND_DIR"
npm run build --no-proxy
ok "ビルド完了"

# ── 4. S3 sync ───────────────────────────────────────────
log "S3 に sync 中..."
aws s3 sync "$FRONTEND_DIR/dist/" "s3://${FRONTEND_BUCKET}/" \
  --profile "$AWS_PROFILE"
ok "S3 sync 完了"

# ── 5. CloudFront invalidation ────────────────────────────
log "CloudFront キャッシュを削除中..."
MSYS_NO_PATHCONV=1 aws cloudfront create-invalidation \
  --distribution-id "$CF_DIST_ID" \
  --paths "/*" \
  --profile "$AWS_PROFILE" \
  --query "Invalidation.{Id:Id,Status:Status}" \
  --output table
ok "Invalidation 発行済み（反映に数分かかります）"

echo ""
ok "デプロイ完了"
FRONTEND_URL=$(cd "$INFRA_DIR" && terraform output -raw frontend_url)
echo "  URL: ${FRONTEND_URL}"
