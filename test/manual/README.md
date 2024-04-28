# Manual Tests

This folder contains files used for performing manual tests that are non-trivial to automate.

## Setup test mod

Run `node packages/lib/dist/node/build_mod.js --source-dir test/manual/test_mod/ --output-dir mods/` to create the test mod.

## Test handling of bad setting values

1.  Create a ModPack with missmatched values with `node test/manual/test_settings_mod_pack.js` and import it.
2.  Run a data export on an instance with the mod pack assigned, the values will get coerced to the correct types.
3.  Use ctl to set the settings back to their wrong values:

    ```bash
    SETTING_TYPES=(bool-setting int-setting double-setting string-setting color-setting)
    VALUE_TYPES=(bool int double string color missing)
    VALUES=(
        --bool-setting false
        --int-setting 1
        --double-setting 0.5
        --string-setting str
        --color-setting '{"r":0,"g":1,"b":0,"a":1}'
        --remove-setting
    )
    node packages/ctl mod-pack edit test-settings $(
        for TYPE in "${SETTING_TYPES[@]}" ; do
            for (( I = 0; I < ${#VALUE_TYPES[@]}; I++ )); do
                printf "%s startup %s-with-%s-value %s " ${VALUES[((I * 2))]} $TYPE ${VALUE_TYPES[I]} ${VALUES[((I * 2 + 1))]}
            done
        done
    )
    ```

4.  Verify that the Web UI gracefully handles all combinations of wrong settings types.
