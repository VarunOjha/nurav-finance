"""Wealth estimator: an AI review of a workspace's money, with code doing the maths.

pool.py     what's in the pool (fixed assets kept out) and the snapshot the model sees
review.py   the prompt and the answer's strict JSON schema
compute.py  checks on the answer; FI number, year, curves, rebalance moves, milestones
pipeline.py review → checks (one retry) → compute → save, streamed as events
"""
