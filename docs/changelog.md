# シフト生成ロジック 変更ログ

## 2026-03-25: 配置均等化・Undo/Redo・集計列

### 1. 事務パートの配置均等化（debtベース）
- **旧**: 累積ペース + 優先度ベース → メインスタッフ（木庭・諫早）が前半に集中
- **新**: 負債（debt）ベースのスコアリングに変更
  - `debt = (target × progress) - actual` で「今この時点で何日遅れているか」を算出
  - debtが大きいスタッフが優先的に出勤 → 月全体で自然にインターリーブ
  - priorityは同debtスタッフ間のタイブレーカーに格下げ

### 2. 徳永のペース配分閾値
- `ahead > 0.15` → `ahead > 0.08` に変更（前半固め打ち防止を強化）

### 3. 木庭の連勤上限
- `max_consecutive_days: 4` をDB（work_conditions）に追加
- 諫早と同じ4連勤上限に統一

### 4. Undo/Redo/Reset機能
- 手動セル変更の履歴管理（最大50件）
- Reset: シフト生成直後の状態に戻す
- `generate.html` にボタン追加済み

### 5. ガントチャート集計列
- スタッフ名の右横に出勤数/公休数を表示
- スタッフ別の閾値で色分け（白/黄/赤）

### 6. 条件チェック文言の簡潔化
- 各チェック項目の`text`を短く読みやすく修正

### 7. 生成パラメータ改善
- 試行回数: 8 → 30
- 既存シフトとスコア比較し、悪化する場合は既存を維持

---

## 2026-03-25: 条件チェックロジックのリファクタリング

### 背景
`scoreShifts()`（スコアリング）と`renderConditionsCheck()`（UIパネル表示）で
同一のチェックロジックが約400行にわたり二重実装されていた。
片方を修正してもう片方を忘れるとバグが発生する温床になっていた。

### 変更内容

#### 1. `runAllChecks()` 共通関数の導入
- 全チェック項目を実行し、構造化データ（`globalItems`, `staffChecks`, `bonusItems`）を返す
- `scoreShifts()` と `renderConditionsCheck()` の両方がこの結果を利用

#### 2. ヘルパー関数のモジュールレベル昇格
以下の関数を `renderConditionsCheck` 内部のクロージャからモジュールレベルに移動：
- `_staffAssignments`, `_workDays`, `_restDays`, `_countPattern`
- `_maxConsecutiveWork`, `_maxConsecutiveWorkIncludingDispense`
- `_countSundays`, `_checkConsecutiveRestPairs`
- `_restOverlap`, `_countCrossStore`, `_getWeeklyBreakdown`, `_dispenseCount`

#### 3. `scoreShifts()` の簡素化
- 旧: 独自にチェックを実行（〜160行）
- 新: `runAllChecks()`の結果から`scoreDelta`を合算するだけ（〜30行）

#### 4. `renderConditionsCheck()` の描画専用化
- 旧: 独自にチェックを実行（〜390行）
- 新: `runAllChecks()`の結果をUIに描画するだけ（〜105行）

### コード量の変化
- **Before**: 2320行
- **After**: 1993行（**-327行**）

---

## 2026-03-24: シフト生成ロジックの改善

### 中村の週またぎ連勤制限
- `canWork()`に`alternating_weeks`に基づく連勤制限を追加
- 週の最大勤務日数を超える連勤を防止

### 小野の6連勤防止
- `computeRestDays()`に`enforceGaps`ロジックを追加
- 公休間に6日以上の空白が生じないよう強制的に休日を挿入

### 徳永の調剤日数考慮
- 調剤（dispense）日を月間出勤カウントの初期値に加算
- 17日目標に調剤日を含めることで、薬2への不要な配置を防止

### 条件チェックパネルの改善
- チェック項目の説明文を詳細化
- 優先順位順にソート（絶対 > 高 > 中 > 低）
- 徳永の「調剤」オプション表示を修復

### 配置アルゴリズムの修正
- `tryAssignOffice()`のスコア計算で、店舗優先順位をペーシングより重視するよう変更
