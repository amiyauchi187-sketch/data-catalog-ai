# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 技術スタック
- Next.js（App Router）と Supabase で作る

## コーディング規約
- コメントとエラーメッセージは日本語で書く
- 関数は小さく分け、1つの関数には1つの仕事だけをさせる
- 新しい機能を足したら、READMEの使い方も更新する

## 作業の進め方
- 大きな変更の前に、方針を3行で説明してから着手する
- 変更後は、実際に動かして結果を確認する

## 秘密情報
- APIキーや接続情報は `.env.local` に置く
- `.env.local` の値は表示しない（画面、ログ、エラーメッセージ、ドキュメントのどこにも出さない）
- `.env.local` はコミットしない

## テストデータ
- テストデータはすべて架空のものを使う。実在の人物・組織・顧客のデータをコピーして使わない

## 禁止事項
- 外部のライブラリ（npmパッケージ）を勝手に追加しない。必要なら先に提案する。ただし Next.js と Supabase の利用に必要な公式パッケージ、および Tailwind CSS は除く
- 保存されているデータを、指示なく削除・上書きしない
- git push は私が指示したときだけ行う
