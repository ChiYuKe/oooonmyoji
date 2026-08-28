from __future__ import annotations

from src.oooonmyoji.config.model import InstanceConfig
from src.oooonmyoji.devices.mumu import MumuPlayerInfo, parse_mumu_manager_info
from src.oooonmyoji.runtime.instances import merge_mumu_players


def test_parse_mumu_manager_info_keeps_android_ready_players() -> None:
    players = parse_mumu_manager_info({
        "2": {
            "index": "2",
            "name": "third",
            "adb_host_ip": "127.0.0.1",
            "adb_port": 16448,
            "android_version": "15.0",
            "is_process_started": True,
            "is_android_started": True,
        },
        "1": {
            "index": "1",
            "name": "starting",
            "is_process_started": True,
            "is_android_started": False,
        },
        "bad": {"index": "not-an-index", "is_process_started": True, "is_android_started": True},
    })

    assert players == (MumuPlayerInfo(2, "third", "127.0.0.1:16448", "15.0"),)


def test_merge_mumu_players_overlays_config_and_appends_new_indexes() -> None:
    configured = (
        InstanceConfig(
            id="main",
            backend="mumu",
            mumu_index=0,
            adb_serial="configured:1234",
            package="com.example.game",
        ),
    )
    players = (
        MumuPlayerInfo(0, "primary", "127.0.0.1:16384", "15.0"),
        MumuPlayerInfo(3, "fourth", "127.0.0.1:16480", "15.0"),
    )

    merged = merge_mumu_players(configured, players)

    assert len(merged) == 2
    assert merged[0].id == "main"
    assert merged[0].display_name == "primary"
    assert merged[0].adb_serial == "configured:1234"
    assert merged[1] == InstanceConfig(
        id="mumu-3",
        backend="mumu",
        mumu_index=3,
        adb_serial="127.0.0.1:16480",
        package="com.example.game",
        display_name="fourth",
    )
