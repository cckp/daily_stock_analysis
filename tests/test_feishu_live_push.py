# -*- coding: utf-8 -*-
"""
飞书推送集成测试（真实发送）

运行方式：
    python -m pytest tests/test_feishu_live_push.py -v -s

依赖 .env 中的 FEISHU_WEBHOOK_URL 和 FEISHU_SIGN_SECRET（或 FEISHU_WEBHOOK_SECRET）。
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from dotenv import load_dotenv

load_dotenv(override=True)

from src.config import Config
from src.notification_sender.feishu_sender import FeishuSender


def _build_config() -> Config:
    url = os.getenv("FEISHU_WEBHOOK_URL")
    # .env 里用的是 FEISHU_SIGN_SECRET，config.py 读的是 FEISHU_WEBHOOK_SECRET，兼容两者
    secret = os.getenv("FEISHU_WEBHOOK_SECRET") or os.getenv("FEISHU_SIGN_SECRET") or ""
    keyword = os.getenv("FEISHU_WEBHOOK_KEYWORD") or ""
    return Config(
        feishu_webhook_url=url,
        feishu_webhook_secret=secret,
        feishu_webhook_keyword=keyword,
    )


class TestFeishuLivePush(unittest.TestCase):

    def setUp(self):
        self.config = _build_config()
        if not self.config.feishu_webhook_url:
            self.skipTest("未配置 FEISHU_WEBHOOK_URL，跳过集成测试")

    def test_send_plain_text(self):
        """发送纯文本消息"""
        sender = FeishuSender(self.config)
        result = sender.send_to_feishu("【测试】飞书推送单元测试 - 纯文本")
        self.assertTrue(result, "飞书推送失败，请检查 webhook URL / 签名密钥是否正确")

    def test_send_markdown(self):
        """发送 Markdown 格式消息"""
        content = (
            "**飞书推送测试**\n\n"
            "| 字段 | 值 |\n"
            "|------|----|\n"
            "| 状态 | 成功 |\n"
            "| 签名 | 已验证 |\n\n"
            "> 这是一条来自单元测试的消息"
        )
        sender = FeishuSender(self.config)
        result = sender.send_to_feishu(content)
        self.assertTrue(result, "飞书 Markdown 推送失败")


if __name__ == "__main__":
    unittest.main(verbosity=2)
