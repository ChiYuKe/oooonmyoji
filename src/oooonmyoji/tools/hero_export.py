"""Desktop warehouse detection, using the same read-only connection and cancellation."""
from .soul_export import main
from ..souls.hero_ownership import acquire_heroes

if __name__ == "__main__":
    raise SystemExit(main(acquire_heroes, "式神仓库"))
