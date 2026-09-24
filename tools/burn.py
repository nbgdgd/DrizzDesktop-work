# CPU burner for trace-probe.cjs: keeps every core busy for N seconds.
import multiprocessing as mp
import sys
import time


def spin(seconds):
    end = time.time() + seconds
    while time.time() < end:
        pass


if __name__ == "__main__":
    seconds = float(sys.argv[1]) if len(sys.argv) > 1 else 14
    with mp.Pool(mp.cpu_count()) as pool:
        pool.map(spin, [seconds] * mp.cpu_count())
