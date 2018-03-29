module Helpers exposing (..)

import Dict exposing (Dict)
import Regex exposing (replace, regex)
import String exposing (join, split)
import Time exposing (Time)


type alias Locale =
    Dict String String


type alias Translate =
    String -> String


type alias Pluralize =
    Int -> String -> String -> String


type alias DistanceOfTime =
    Time -> Time -> String


type alias NumberToHumanSize =
    Int -> String


type alias Helpers =
    { t : Translate
    , pluralize : Pluralize
    , distance_of_time_in_words : DistanceOfTime
    , number_to_human_size : NumberToHumanSize
    }


forLocale : Locale -> Helpers
forLocale locale =
    Helpers (translate locale)
        (pluralize locale)
        (distance_of_time_in_words locale)
        (number_to_human_size locale)


translate : Locale -> Translate
translate locale key =
    case
        Dict.get key locale
    of
        Nothing ->
            key

        Just translation ->
            translation


isSingular : Int -> Bool
isSingular count =
    count == 1


pluralize : Locale -> Pluralize
pluralize locale count singular plural =
    let
        translated =
            if isSingular count then
                translate locale singular
            else
                translate locale plural
    in
        (toString count) ++ " " ++ translated


interpolate : String -> String -> String
interpolate string arg =
    replace Regex.All (regex "\\{\\d\\}") (\_ -> arg) string


distance_of_time_in_words : Locale -> DistanceOfTime
distance_of_time_in_words locale from_time to_time =
    let
        distance =
            to_time - from_time

        distance_in_minutes =
            round (Time.inMinutes distance)

        distance_in_hours =
            round (Time.inHours distance)

        distance_in_days =
            round (Time.inHours distance / 24)

        distance_in_months =
            round (Time.inHours distance / (24 * 30))

        transform count what =
            let
                key =
                    if isSingular count then
                        "Helpers {0} " ++ what ++ " ago"
                    else
                        "Helpers {0} " ++ what ++ "s ago"
            in
                interpolate (translate locale key) (toString count)
    in
        if distance_in_months > 0 then
            transform distance_in_months "month"
        else if distance_in_days > 0 then
            transform distance_in_days "day"
        else if distance_in_hours > 0 then
            transform distance_in_hours "hour"
        else if distance_in_minutes > 0 then
            transform distance_in_minutes "minute"
        else
            translate locale "Helpers Just now"


number_to_human_size : Locale -> NumberToHumanSize
number_to_human_size locale size =
    if size < 10 ^ 3 then
        pluralize locale size "Helpers Byte" "Helpers Bytes"
    else if size < 10 ^ 6 then
        (toString (toFloat (size // 10 ^ 2) / 10)) ++ " " ++ (translate locale "Helpers KB")
    else if size < 10 ^ 9 then
        (toString (toFloat (size // 10 ^ 5) / 10)) ++ " " ++ (translate locale "Helpers MB")
    else
        (toString (toFloat (size // 10 ^ 9) / 10)) ++ " " ++ (translate locale "Helpers GB")


splitPath : String -> ( String, ( String, String ) )
splitPath fullpath =
    case List.reverse (String.split "/" fullpath) of
        [] ->
            ( "", ( "", "" ) )

        [ rest ] ->
            ( "", ( rest, "" ) )

        [ filename, rest ] ->
            ( rest ++ "/", (splitFileName filename) )

        filename :: rest ->
            ( (String.join "/" (List.reverse rest)), splitFileName filename )


splitFileName : String -> ( String, String )
splitFileName filename =
    case List.reverse (String.split "." filename) of
        [] ->
            ( "", "" )

        [ rest ] ->
            ( rest, "" )

        [ ext, rest ] ->
            if rest == "" then
                ( "." ++ ext, "" )
            else
                ( rest, "." ++ ext )

        ext :: rest ->
            ( (String.join "." (List.reverse rest)), "." ++ ext )
