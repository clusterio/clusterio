for x in $(dirname $0)/*.dot; do
    echo $x
    dot $x -Tsvg -o ${x/.dot/.svg}
done
