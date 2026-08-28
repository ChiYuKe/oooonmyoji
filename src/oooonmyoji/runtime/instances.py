"""Runtime MuMu instance discovery and config expansion."""

from __future__ import annotations

from dataclasses import replace
import re

from ..config.model import AppConfig, InstanceConfig
from ..devices.mumu import MumuPlayerInfo, discover_running_mumu_players


_AUTO_INSTANCE_ID = re.compile(r"^mumu-(\d+)$")


def merge_mumu_players(
    configured: tuple[InstanceConfig, ...],
    players: tuple[MumuPlayerInfo, ...],
) -> tuple[InstanceConfig, ...]:
    """Overlay discovered metadata and append previously unconfigured players."""

    merged = list(configured)
    ids = {instance.id for instance in configured}
    positions_by_index = {
        instance.mumu_index: position
        for position, instance in enumerate(configured)
        if instance.backend == "mumu"
    }
    default_package = next(
        (instance.package for instance in configured if instance.backend == "mumu" and instance.package),
        None,
    )
    for player in players:
        position = positions_by_index.get(player.index)
        if position is not None:
            current = merged[position]
            merged[position] = replace(
                current,
                adb_serial=current.adb_serial or player.adb_serial,
                display_name=player.name or current.display_name,
            )
            continue
        instance_id = f"mumu-{player.index}"
        if instance_id in ids:
            instance_id = f"mumu-native-{player.index}"
        suffix = 2
        candidate = instance_id
        while candidate in ids:
            candidate = f"{instance_id}-{suffix}"
            suffix += 1
        instance_id = candidate
        ids.add(instance_id)
        positions_by_index[player.index] = len(merged)
        merged.append(InstanceConfig(
            id=instance_id,
            backend="mumu",
            mumu_index=player.index,
            adb_serial=player.adb_serial,
            package=default_package,
            display_name=player.name,
        ))
    return tuple(merged)


def expand_runtime_instances(config: AppConfig) -> AppConfig:
    if not config.discover_mumu_instances:
        return config
    players = discover_running_mumu_players(config.mumu_path)
    instances = merge_mumu_players(config.instances, players)
    return config if instances == config.instances else replace(config, instances=instances)


def ensure_runtime_instance(config: AppConfig, instance_id: str) -> AppConfig:
    """Allow a recently discovered mumu-N selection to survive a transient rescan failure."""

    if any(instance.id == instance_id for instance in config.instances):
        return config
    match = _AUTO_INSTANCE_ID.fullmatch(instance_id)
    if not config.discover_mumu_instances or match is None:
        return config
    default_package = next(
        (instance.package for instance in config.instances if instance.backend == "mumu" and instance.package),
        None,
    )
    dynamic = InstanceConfig(
        id=instance_id,
        backend="mumu",
        mumu_index=int(match.group(1)),
        package=default_package,
    )
    return replace(config, instances=(*config.instances, dynamic))


__all__ = ["ensure_runtime_instance", "expand_runtime_instances", "merge_mumu_players"]
